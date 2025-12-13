const STATE_KEY = 'tourveron_v6_data'; 
const REEL_ITEM_HEIGHT = 60; 
const REEL_WINDOW_HEIGHT = 180; 

let state = {
    settings: { 
        method: 'kick', 
        channel: '', 
        limit: 50,
        soundEnabled: true,
        volume: 0.5 
    },
    roundBonuses: {}, 
    participants: [],
    matches: [],
    isStarted: false,
    isMonitoring: true,
    matchSequence: 1,
    sidebarCollapsed: false
};

let ws = null;
let processedMsgIds = new Set();
let resizeTimer = null;
let inputDebounceTimer = null; 
let winnerDelayTimer = null; 

// --- AUDIO CONTEXT ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const masterGain = audioCtx.createGain();
masterGain.connect(audioCtx.destination);

function updateAudioSettings() {
    masterGain.gain.value = state.settings.soundEnabled ? state.settings.volume : 0;
}

// Звук победы
function playWinSound() {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    
    // Фанфары
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t + i*0.1); 
        
        gain.gain.setValueAtTime(0.3, t + i*0.1);
        gain.gain.exponentialRampToValueAtTime(0.01, t + i*0.1 + 1.5);
        
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(t + i*0.1);
        osc.stop(t + i*0.1 + 1.5);
    });
}

// Звук щелчка рулетки
function playClickSound() {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.type = 'square'; // Резкий звук
    osc.frequency.setValueAtTime(200, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.03); // Быстрый спад
    
    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    
    osc.connect(gain);
    gain.connect(masterGain);
    
    osc.start(t);
    osc.stop(t + 0.04);
}

// Проигрывание звука рулетки с замедлением (durationMs = время анимации)
function playRouletteSound(durationMs) {
    if (!state.settings.soundEnabled) return;
    
    const startTime = Date.now();
    
    function tick() {
        const elapsed = Date.now() - startTime;
        if (elapsed >= durationMs) return;

        playClickSound();

        // Прогресс от 0 до 1
        const progress = elapsed / durationMs;
        // Задержка растет экспоненциально: начало 50мс, конец 400мс
        const nextDelay = 50 + (350 * (progress * progress)); 

        setTimeout(tick, nextDelay);
    }
    tick();
}

window.onload = () => {
    loadState();
    updateAudioSettings();
    setupEvents();
    if (state.isStarted) {
        restoreSession();
    } else {
        updateUIFromSettings();
    }
    
    startSnow();

    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            drawConnectors();
        }, 50);
    });
};

function setupEvents() {
    document.getElementById('btn-settings').onclick = () => showModal('settings-modal');
    document.getElementById('close-settings').onclick = () => hideModal('settings-modal');
    document.getElementById('btn-save-settings').onclick = saveSettings;
    
    document.getElementById('setting-method').onchange = toggleMethodSettings;
    
    document.getElementById('btn-open-tg-parser').onclick = () => showModal('tg-parser-modal');
    document.getElementById('close-tg').onclick = () => hideModal('tg-parser-modal');
    document.getElementById('btn-parse-tg').onclick = parseTelegram;

    document.getElementById('btn-start').onclick = startSession;
    document.getElementById('btn-menu').onclick = resetToMenu;
    document.getElementById('btn-roll').onclick = startRoulette;
    
    document.getElementById('btn-manual-add').onclick = openAddModal;
    document.getElementById('btn-confirm-add').onclick = confirmAddParticipant;

    document.getElementById('btn-confirm-edit').onclick = confirmEditParticipant;

    document.getElementById('btn-toggle-sidebar').onclick = toggleSidebar;
    
    // Close banner
    document.getElementById('close-banner').onclick = hideWinnerBanner;

    setupEnterKey('add-modal', 'btn-confirm-add');
    setupEnterKey('settings-modal', 'btn-save-settings');
    setupEnterKey('edit-modal', 'btn-confirm-edit');
    setupEnterKey('tg-parser-modal', 'btn-parse-tg');
}

function setupEnterKey(modalId, btnId) {
    const modal = document.getElementById(modalId);
    if(!modal) return;
    const inputs = modal.querySelectorAll('input, select, textarea');
    inputs.forEach(el => {
        el.addEventListener('keyup', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                document.getElementById(btnId).click();
            }
        });
    });
}

function showModal(id) { 
    const el = document.getElementById(id);
    el.classList.remove('hidden'); 
    const inp = el.querySelector('input, textarea');
    if(inp) setTimeout(() => inp.focus(), 50);
}
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

function openAddModal() {
    document.getElementById('manual-name').value = '';
    document.getElementById('manual-msg').value = '';
    showModal('add-modal');
}

function confirmAddParticipant() {
    const name = document.getElementById('manual-name').value.trim();
    const msg = document.getElementById('manual-msg').value.trim() || "Manual";
    if(name) {
        addParticipant(name, msg, '#ffffff', true);
        hideModal('add-modal');
    }
}

function openEditModal(id, matchId = null) {
    let name = '';
    let msg = '';
    
    if (matchId) {
        const match = state.matches.find(m => m.id === matchId);
        if (match) {
            const p = state.participants.find(x => x.id === id);
            name = p ? p.name : 'Unknown';
            msg = (match.p1Id === id) ? (match.p1Msg || "") : (match.p2Msg || "");
        }
        document.getElementById('edit-name').disabled = true;
    } else {
        const p = state.participants.find(x => x.id === id);
        if(p) {
            name = p.name;
            msg = p.msg;
        }
        document.getElementById('edit-name').disabled = false;
    }

    document.getElementById('edit-id').value = id;
    document.getElementById('edit-match-id').value = matchId || '';
    document.getElementById('edit-name').value = name;
    document.getElementById('edit-msg').value = msg;
    showModal('edit-modal');
}

function confirmEditParticipant() {
    const id = document.getElementById('edit-id').value;
    const matchId = document.getElementById('edit-match-id').value;
    const name = document.getElementById('edit-name').value;
    const msg = document.getElementById('edit-msg').value;

    if (matchId) {
        const match = state.matches.find(m => m.id === matchId);
        if (match) {
            if (match.p1Id === id) match.p1Msg = msg;
            else if (match.p2Id === id) match.p2Msg = msg;
            saveState();
            renderBracket();
        }
    } else {
        const p = state.participants.find(x => x.id === id);
        if(p) {
            p.name = name;
            p.msg = msg;
            
            // Если меняем имя, оно должно поменяться везде, а сообщение - глобально, но локальные остаются (если они были перезаписаны)
            // Но в нашей логике renderBracket берет глобальное если локального нет. 
            // Поэтому, чтобы обновить везде, обновляем и локальные поля матчей, если они установлены.
            state.matches.forEach(m => {
                // Здесь решаем: при глобальном редактировании обновляем ли все матчи? 
                // Да, пользователь ожидает этого в сайдбаре.
                if(m.p1Id === id) m.p1Msg = msg;
                if(m.p2Id === id) m.p2Msg = msg;
            });

            saveState();
            renderParticipants();
            renderBracket();
        }
    }
    hideModal('edit-modal');
}

function saveState() { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
function loadState() {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
        try {
            state = JSON.parse(raw);
            if (!state.roundBonuses) state.roundBonuses = {};
            // Init default sound settings if missing
            if (state.settings.soundEnabled === undefined) state.settings.soundEnabled = true;
            if (state.settings.volume === undefined) state.settings.volume = 0.5;
        } catch(e) { console.error("Save load error", e); }
    }
}

function updateUIFromSettings() {
    const s = state.settings;
    document.getElementById('setting-method').value = s.method;
    document.getElementById('setting-channel').value = s.channel;
    document.getElementById('setting-limit').value = s.limit;
    document.getElementById('setting-sound-enabled').checked = s.soundEnabled;
    document.getElementById('setting-volume').value = s.volume;
    
    document.getElementById('max-count-display').textContent = s.limit;
    toggleMethodSettings();
    updateStartBtn();
}

function toggleMethodSettings() {
    const method = document.getElementById('setting-method').value;
    const isKick = method === 'kick';
    document.getElementById('kick-settings').classList.toggle('hidden', !isKick);
    document.getElementById('limit-group').classList.toggle('hidden', !isKick);
    document.getElementById('limit-display-wrapper').style.display = isKick ? 'inline' : 'none';
    document.getElementById('telegram-settings').classList.toggle('hidden', isKick);
}

function saveSettings() {
    state.settings.method = document.getElementById('setting-method').value;
    state.settings.channel = document.getElementById('setting-channel').value.trim();
    state.settings.limit = parseInt(document.getElementById('setting-limit').value);
    state.settings.soundEnabled = document.getElementById('setting-sound-enabled').checked;
    state.settings.volume = parseFloat(document.getElementById('setting-volume').value);
    
    updateAudioSettings();
    document.getElementById('max-count-display').textContent = state.settings.limit;
    saveState();
    updateStartBtn();
    hideModal('settings-modal');
}

function updateStartBtn() {
    const method = state.settings.method;
    let ready = false;
    if (method === 'kick' && state.settings.channel) ready = true;
    if (method === 'telegram' && state.participants.length > 0) ready = true;
    document.getElementById('btn-start').disabled = !ready;
}

function parseTelegram() {
    const input = document.getElementById('tg-raw-input').value.trim();
    if (!input) return;
    
    const lines = input.split('\n');
    let added = 0;
    const regHeader = /^(.+?),\s*\[\d/;
    
    let bufferName = null;
    let bufferMsg = [];

    const flush = () => {
        if(bufferName) {
            const msg = bufferMsg.join(' ').trim() || 'Участник';
            addParticipant(bufferName, msg, '#ccc', true); 
            added++;
        }
    };

    lines.forEach(line => {
        line = line.trim();
        if(!line) return;
        const match = line.match(regHeader);
        if(match) {
            flush();
            bufferName = match[1].trim();
            bufferMsg = [];
        } else {
            if(bufferName) bufferMsg.push(line);
        }
    });
    flush();

    document.getElementById('tg-count').textContent = state.participants.length;
    document.getElementById('tg-raw-input').value = '';
    hideModal('tg-parser-modal');
    updateStartBtn();
    alert(`Добавлено: ${added}`);
}

function startSession() {
    state.isStarted = true;
    saveState();
    restoreSession();
}

function restoreSession() {
    document.getElementById('start-overlay').classList.add('hidden');
    document.getElementById('app-container').classList.remove('hidden');
    
    if(state.sidebarCollapsed) {
        document.getElementById('sidebar').classList.add('collapsed');
        document.querySelector('.toggle-sidebar-btn i').classList.remove('fa-chevron-left');
        document.querySelector('.toggle-sidebar-btn i').classList.add('fa-chevron-right');
    }

    renderParticipants();
    renderBracket();
    checkLimit();
    
    if (state.settings.method === 'kick') {
        connectKick(state.settings.channel);
        document.getElementById('monitor-status').textContent = state.isMonitoring ? "Мониторинг открыт" : "Мониторинг закрыт";
        const dot = document.getElementById('status-dot');
        dot.style.background = state.isMonitoring ? '#00ffaa' : '#ff4444';
    }
}

function resetToMenu() {
    if(confirm("Вернуться в меню? Прогресс турнира будет сброшен.")) {
        localStorage.removeItem(STATE_KEY);
        location.reload();
    }
}

function checkLimit() {
    if (state.settings.method === 'telegram') return;
    const cur = state.participants.length;
    const max = state.settings.limit;
    document.getElementById('count').textContent = cur;
    
    const statusTxt = document.getElementById('monitor-status');
    const dot = document.getElementById('status-dot');

    if (cur >= max) {
        state.isMonitoring = false;
        statusTxt.textContent = "Лимит (Сбор закрыт)";
        dot.style.background = '#ff4444';
    }
}

function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    sb.classList.toggle('collapsed');
    state.sidebarCollapsed = sb.classList.contains('collapsed');
    
    const icon = document.querySelector('.toggle-sidebar-btn i');
    if(state.sidebarCollapsed) {
        icon.classList.remove('fa-chevron-left');
        icon.classList.add('fa-chevron-right');
    } else {
        icon.classList.remove('fa-chevron-right');
        icon.classList.add('fa-chevron-left');
    }
    
    saveState();
    setTimeout(() => {
        drawConnectors();
    }, 350);
}

function addParticipant(name, msg, color, isManual = false) {
    if (state.settings.method === 'kick' && !isManual) {
        if (state.participants.length >= state.settings.limit) {
            state.isMonitoring = false;
            checkLimit(); 
            return;
        }
    }
    
    if (state.participants.find(p => p.name === name)) return;

    state.participants.push({
        id: 'u_' + Date.now() + Math.random().toString(36).substr(2,4),
        name, msg, color, status: 'waiting'
    });
    
    checkLimit();
    saveState();
    renderParticipants();
    updateStartBtn();
}

function removeParticipant(id) {
    if(!confirm('Удалить участника?')) return;
    state.participants = state.participants.filter(p => p.id !== id);
    if(state.settings.method === 'kick') {
        state.isMonitoring = true;
        document.getElementById('monitor-status').textContent = "Сбор открыт";
        document.getElementById('status-dot').style.background = '#00ffaa';
    }
    saveState();
    renderParticipants();
    checkLimit();
}

function renderParticipants() {
    const list = document.getElementById('participants-list');
    list.innerHTML = '';
    document.getElementById('count').textContent = state.participants.length;

    state.participants.forEach(p => {
        const div = document.createElement('div');
        div.className = `participant-row ${p.status === 'in-game' ? 'in-game' : ''}`;
        div.innerHTML = `
            <div class="p-info">
                <span class="p-name" style="color:${p.color || '#fff'}">${p.name}</span>
                <div class="p-msg">${p.msg}</div>
            </div>
            <div class="p-actions">
                <i class="fas fa-pen p-icon edit" onclick="openEditModal('${p.id}')"></i>
                <i class="fas fa-trash p-icon del" onclick="removeParticipant('${p.id}')"></i>
            </div>
        `;
        list.appendChild(div);
    });
}

function startRoulette() {
    if (state.settings.method === 'kick' && state.isMonitoring) {
        state.isMonitoring = false;
        document.getElementById('monitor-status').textContent = "Сбор закрыт";
        document.getElementById('status-dot').style.background = '#ff4444';
        saveState();
    }

    const available = state.participants.filter(p => p.status === 'waiting');
    if (available.length < 2) {
        alert("Нужно минимум 2 свободных участника.");
        return;
    }

    const idx1 = Math.floor(Math.random() * available.length);
    let idx2 = Math.floor(Math.random() * available.length);
    while(idx1 === idx2) idx2 = Math.floor(Math.random() * available.length);

    const p1 = available[idx1];
    const p2 = available[idx2];

    runRouletteAnim(available, p1, p2, false).then(() => {
        createMatch(1, p1.id, p2.id);
    });
}

function runRouletteAnim(pool, p1, p2, isSingle = false) {
    return new Promise(resolve => {
        const modal = document.getElementById('roulette-modal');
        const wrapper = document.getElementById('reels-wrapper');
        const sL = document.getElementById('strip-left');
        const sR = document.getElementById('strip-right');
        
        modal.classList.remove('hidden');
        
        if(isSingle) wrapper.classList.add('single-mode');
        else wrapper.classList.remove('single-mode');

        const WIN_INDEX = 24; 
        const TOTAL_ITEMS = 35;

        const buildStrip = (winner) => {
            if (!winner) return ''; 
            let html = '';
            for(let i=0; i<TOTAL_ITEMS; i++) {
                if(i === WIN_INDEX) {
                    html += `<li style="color:#00ffaa; text-shadow:0 0 10px #00ffaa;">${winner.name}</li>`;
                } else {
                    const r = pool[Math.floor(Math.random() * pool.length)];
                    html += `<li>${r.name}</li>`;
                }
            }
            return html;
        };

        sL.innerHTML = buildStrip(p1);
        if(!isSingle) sR.innerHTML = buildStrip(p2);

        sL.style.transition = 'none'; sL.style.transform = 'translateY(0)';
        if(!isSingle) { sR.style.transition = 'none'; sR.style.transform = 'translateY(0)'; }

        const centerOffset = (REEL_WINDOW_HEIGHT / 2) - ((WIN_INDEX * REEL_ITEM_HEIGHT) + (REEL_ITEM_HEIGHT / 2));
        
        // Запуск звука рулетки (4000мс = 4с)
        playRouletteSound(4000);

        setTimeout(() => {
            const css = `transform 4s cubic-bezier(0.15, 0.9, 0.3, 1)`;
            sL.style.transition = css;
            sL.style.transform = `translateY(${centerOffset}px)`;
            
            if(!isSingle) {
                sR.style.transition = css;
                sR.style.transform = `translateY(${centerOffset}px)`;
            }
        }, 50);

        setTimeout(() => {
            modal.classList.add('hidden');
            resolve();
        }, 4500);
    });
}

function getBonusCount(round) { return state.roundBonuses[round] || 1; }
function setBonusCount(round, val) { 
    state.roundBonuses[round] = parseInt(val); 
    saveState(); 
    renderBracket();
}

function createMatch(round, p1Id, p2Id, forcedSlot = null) {
    const empty = Array(5).fill({c:'', w:''});
    
    const part1 = state.participants.find(p=>p.id===p1Id);
    const part2 = state.participants.find(p=>p.id===p2Id);
    if(part1) part1.status = 'in-game';
    if(part2) part2.status = 'in-game';

    let slot = forcedSlot;
    if (slot === null) {
        const matchesInThisRound = state.matches.filter(m => m.round === round);
        slot = matchesInThisRound.length;
    }

    const match = {
        id: 'm_' + Date.now() + Math.random().toString(36).substr(2,4),
        seq: state.matchSequence++,
        round,
        p1Id, p2Id,
        p1Msg: part1 ? part1.msg : "",
        p2Msg: part2 ? part2.msg : "",
        res: { p1: JSON.parse(JSON.stringify(empty)), p2: JSON.parse(JSON.stringify(empty)) },
        winnerId: null,
        nextMatchId: null,
        bracketSlot: slot
    };

    state.matches.push(match);
    saveState();
    renderParticipants();
    renderBracket();
    return match;
}

function deleteMatch(id) {
    if(!confirm("Удалить этот матч?")) return;
    
    const m = state.matches.find(x => x.id === id);
    if(!m) return;

    const release = (pid) => {
        const p = state.participants.find(x => x.id === pid);
        if(p) p.status = 'waiting';
    };
    
    if (!m.nextMatchId) {
        release(m.p1Id);
        release(m.p2Id);
    }

    state.matches = state.matches.filter(x => x.id !== id);
    
    state.matches.forEach(om => {
        if(om.nextMatchId === id) om.nextMatchId = null;
    });

    saveState();
    renderParticipants();
    renderBracket();
    
    setTimeout(drawConnectors, 100);
}

function rerollMatchPlayer(matchId, pSlot) {
    if(!confirm("Вы уверены, что хотите сделать рерол этого игрока?")) return;

    const match = state.matches.find(m => m.id === matchId);
    if(!match) return;

    const available = state.participants.filter(p => p.status === 'waiting');
    if (available.length === 0) {
        alert("Нет свободных игроков для замены!");
        return;
    }

    const newP = available[Math.floor(Math.random() * available.length)];

    runRouletteAnim(available, newP, null, true).then(() => {
        const oldPid = pSlot === 1 ? match.p1Id : match.p2Id;
        const oldP = state.participants.find(p => p.id === oldPid);
        if(oldP) oldP.status = 'waiting';
        
        newP.status = 'in-game';
        if (pSlot === 1) {
            match.p1Id = newP.id;
            match.p1Msg = newP.msg; 
        } else {
            match.p2Id = newP.id;
            match.p2Msg = newP.msg;
        }

        saveState();
        renderParticipants();
        renderBracket();
    });
}

function onInput(matchId, pIdx, bonusIdx, field, val) {
    const match = state.matches.find(m => m.id === matchId);
    if (!match) return;

    if (pIdx === 1) match.res.p1[bonusIdx][field] = val;
    else match.res.p2[bonusIdx][field] = val;
    
    updateMatchVisualsOnly(match);

    clearTimeout(inputDebounceTimer);
    clearTimeout(winnerDelayTimer); 

    saveState(); 

    inputDebounceTimer = setTimeout(() => {
        checkWinner(match);
    }, 50); 
}

function calculateScore(bonuses, count) {
    let sum = 0, k = 0;
    for(let i=0; i<count; i++) {
        const c = parseFloat(bonuses[i].c);
        const w = parseFloat(bonuses[i].w);
        if(!isNaN(c) && c > 0 && !isNaN(w)) {
            sum += (w/c)*100; 
            k++; 
        }
    }
    return k > 0 ? (sum/k) : 0;
}

function hasAnyData(p1Res, p2Res, count) {
    for(let i=0; i<count; i++) {
        const c1 = p1Res[i].c, w1 = p1Res[i].w;
        const c2 = p2Res[i].c, w2 = p2Res[i].w;
        if(c1!=='' && w1!=='' && c2!=='' && w2!=='') return true;
    }
    return false;
}

function updateMatchVisualsOnly(match) {
    const el = document.getElementById(match.id);
    if(!el) return; 

    const count = getBonusCount(match.round);
    
    const x1Val = calculateScore(match.res.p1, count);
    const x2Val = calculateScore(match.res.p2, count);
    
    const x1 = x1Val.toFixed(1);
    const x2 = x2Val.toFixed(1);

    el.querySelector('.x1').textContent = x1 + 'x';
    if(match.p2Id) el.querySelector('.x2').textContent = x2 + 'x';

    const p1Box = el.querySelector('.p1-box');
    const p2Box = el.querySelector('.p2-box');
    
    p1Box.classList.remove('winner', 'loser');
    if(p2Box) p2Box.classList.remove('winner', 'loser');

    if (!match.p2Id) {
        let hasData = false;
        for(let i=0; i<count; i++) if(match.res.p1[i].c!=='' && match.res.p1[i].w!=='') hasData = true;
        if(hasData) p1Box.classList.add('winner');
        return;
    }

    if (hasAnyData(match.res.p1, match.res.p2, count)) {
        if (x1Val > x2Val) {
            p1Box.classList.add('winner'); p2Box.classList.add('loser');
        } else if (x2Val > x1Val) {
            p2Box.classList.add('winner'); p1Box.classList.add('loser');
        }
    }
}

function checkWinner(match) {
    const count = getBonusCount(match.round);
    let newWinner = null;

    if (!match.p2Id) {
        let hasData = false;
        for(let i=0; i<count; i++) if(match.res.p1[i].c!=='' && match.res.p1[i].w!=='') hasData = true;
        if(hasData) newWinner = match.p1Id;
    } else {
        if(hasAnyData(match.res.p1, match.res.p2, count)) {
            const x1 = calculateScore(match.res.p1, count);
            const x2 = calculateScore(match.res.p2, count);
            if(x1 > x2) newWinner = match.p1Id;
            else if(x2 > x1) newWinner = match.p2Id;
        }
    }

    if (newWinner) {
        if (newWinner !== match.winnerId) {
            match.winnerId = newWinner;
            saveState();
            propagateWinner(match);
        }
    }
}

function propagateWinner(finishedMatch) {
    const winnerId = finishedMatch.winnerId;
    const winnerObj = state.participants.find(p=>p.id === winnerId);
    const winnerName = winnerObj?.name || 'Unknown';
    const winnerMsg = (finishedMatch.p1Id === winnerId ? finishedMatch.p1Msg : finishedMatch.p2Msg) || winnerObj?.msg;

    if (finishedMatch.nextMatchId) {
        const next = state.matches.find(m => m.id === finishedMatch.nextMatchId);
        if(next) {
            const oldP1 = next.p1Id;
            const oldP2 = next.p2Id;
            
            if(oldP1 === null || oldP1 === finishedMatch.p1Id || oldP1 === finishedMatch.p2Id) {
                next.p1Id = winnerId;
                next.p1Msg = winnerMsg; 
            } else if (oldP2 === null || oldP2 === finishedMatch.p1Id || oldP2 === finishedMatch.p2Id) {
                next.p2Id = winnerId;
                next.p2Msg = winnerMsg; 
            } else {
                if(next.p1Id === null) { next.p1Id = winnerId; next.p1Msg = winnerMsg; }
                else { next.p2Id = winnerId; next.p2Msg = winnerMsg; }
            }

            next.winnerId = null; 
            next.res.p1.forEach(b => {b.c=''; b.w='';});
            next.res.p2.forEach(b => {b.c=''; b.w='';});
            
            saveState();
            renderBracket();
        }
        return;
    }

    const nextRound = finishedMatch.round + 1;
    let mySlot = finishedMatch.bracketSlot;
    if (mySlot === undefined || mySlot === null) {
        const roundsMatches = state.matches.filter(m => m.round === finishedMatch.round).sort((a,b) => a.seq - b.seq);
        mySlot = roundsMatches.indexOf(finishedMatch);
    }
    
    const targetSlot = Math.floor(mySlot / 2);
    const isTargetP1 = (mySlot % 2) === 0;

    let targetMatch = state.matches.find(m => m.round === nextRound && m.bracketSlot === targetSlot);

    if (targetMatch) {
        if (isTargetP1) { targetMatch.p1Id = winnerId; targetMatch.p1Msg = winnerMsg; }
        else { targetMatch.p2Id = winnerId; targetMatch.p2Msg = winnerMsg; }
        
        finishedMatch.nextMatchId = targetMatch.id;
        saveState();
        renderBracket();
    } else {
        const pendingInCurrentRound = state.matches.some(m => m.round === finishedMatch.round && m.id !== finishedMatch.id && !m.winnerId);
        const matchesInNextRound = state.matches.some(m => m.round === nextRound);
        
        if (!state.roundBonuses[nextRound]) state.roundBonuses[nextRound] = 1;
        
        const empty = Array(5).fill({c:'', w:''});
        const newMatch = {
            id: 'm_' + Date.now() + Math.random().toString(36).substr(2,4),
            seq: state.matchSequence++,
            round: nextRound,
            p1Id: isTargetP1 ? winnerId : null,
            p2Id: isTargetP1 ? null : winnerId,
            p1Msg: isTargetP1 ? winnerMsg : "",
            p2Msg: isTargetP1 ? "" : winnerMsg,
            res: { p1: JSON.parse(JSON.stringify(empty)), p2: JSON.parse(JSON.stringify(empty)) },
            winnerId: null, 
            nextMatchId: null,
            bracketSlot: targetSlot
        };

        if (!pendingInCurrentRound && !matchesInNextRound && finishedMatch.round > 1) {
             showWinnerNotification(winnerName);
             playWinSound();
             launchConfetti();
             renderBracket(); 
             return;
        }

        state.matches.push(newMatch);
        finishedMatch.nextMatchId = newMatch.id;
        saveState();
        renderBracket();
    }
}

function showWinnerNotification(name) {
    const banner = document.getElementById('winner-banner');
    document.getElementById('banner-winner-name').textContent = name;
    
    setTimeout(() => {
        banner.classList.add('show');
    }, 3000);
}

function hideWinnerBanner() {
    document.getElementById('winner-banner').classList.remove('show');
}

function renderBracket() {
    // FIX: Cursor Logic (Capture)
    let activeId = null;
    let selectionStart = 0;
    let selectionEnd = 0;
    
    if(document.activeElement && document.activeElement.tagName === 'INPUT') {
        activeId = document.activeElement.id;
        selectionStart = document.activeElement.selectionStart;
        selectionEnd = document.activeElement.selectionEnd;
    }

    const area = document.getElementById('tournament-area');
    const scrollLeft = area.scrollLeft;
    const scrollTop = area.scrollTop;

    area.innerHTML = '';
    
    const hasNextRound = state.matches.some(m => m.round > 1);
    const rollBtn = document.getElementById('btn-roll');
    if(rollBtn) {
        rollBtn.disabled = hasNextRound;
        rollBtn.style.opacity = hasNextRound ? '0.5' : '1';
        rollBtn.style.cursor = hasNextRound ? 'not-allowed' : 'pointer';
        if(hasNextRound) rollBtn.title = "Турнир перешел на следующую стадию";
        else rollBtn.title = "";
    }
    
    const roundsMap = {};
    if(state.matches.length === 0) return;

    state.matches.forEach(m => {
        if(!roundsMap[m.round]) roundsMap[m.round] = [];
        roundsMap[m.round].push(m);
    });

    const roundNums = Object.keys(roundsMap).sort((a,b)=>a-b);

    roundNums.forEach(rNum => {
        const col = document.createElement('div');
        col.className = 'round-column';
        col.id = `round-${rNum}`;
        
        const header = document.createElement('div');
        header.className = 'round-header';
        header.innerHTML = `<div>Раунд ${rNum}</div>`;
        
        const settingsDiv = document.createElement('div');
        settingsDiv.className = 'round-settings';
        const sel = document.createElement('select');
        [1,2,3,4,5].forEach(v => {
            const opt = document.createElement('option');
            opt.value = v; opt.textContent = v + ' Bonus';
            if(getBonusCount(rNum) == v) opt.selected = true;
            sel.appendChild(opt);
        });
        sel.onchange = (e) => setBonusCount(rNum, e.target.value);
        settingsDiv.appendChild(sel);
        header.appendChild(settingsDiv);
        
        col.appendChild(header);

        roundsMap[rNum].sort((a,b) => {
            if(a.bracketSlot !== undefined && b.bracketSlot !== undefined) return a.bracketSlot - b.bracketSlot;
            return a.seq - b.seq;
        }).forEach(m => {
            col.appendChild(createMatchHTML(m));
        });

        area.appendChild(col);
    });

    area.scrollTop = scrollTop;
    area.scrollLeft = scrollLeft;

    setTimeout(() => {
        drawConnectors();
        // FIX: Cursor Logic (Restore)
        if(activeId) {
            const el = document.getElementById(activeId);
            if(el) {
                el.focus();
                // Важно: setSelectionRange работает только если элемент в фокусе и это text/search/url/tel/password
                // Для type="number" это может не работать в некоторых браузерах.
                // Если не работает, меняем type="text" или миримся. Но обычно работает.
                try {
                    el.setSelectionRange(selectionStart, selectionEnd);
                } catch(e) {}
            }
        }
    }, 0);
}

function createMatchHTML(m) {
    const div = document.createElement('div');
    div.className = 'match-card';
    div.id = m.id;

    const p1 = state.participants.find(p=>p.id===m.p1Id) || {name:'Ожидание...', msg:'...', color:'#555'};
    const p2 = m.p2Id ? (state.participants.find(p=>p.id===m.p2Id) || {name:'Ожидание...', msg:'...', color:'#555'}) : null;

    const p1Msg = m.p1Msg || p1.msg;
    const p2Msg = m.p2Msg || (p2 ? p2.msg : '...');

    const bonusesCount = getBonusCount(m.round);

    const genInputs = (pidx, resArr) => {
        let html = '';
        for(let i=0; i<bonusesCount; i++) {
            const valC = resArr[i] ? resArr[i].c : '';
            const valW = resArr[i] ? resArr[i].w : '';
            const idC = `input_${m.id}_${pidx}_${i}_c`;
            const idW = `input_${m.id}_${pidx}_${i}_w`;
            
            // Используем type="text" с inputmode="numeric" для лучшей поддержки курсора
            html += `
            <div class="inputs-row">
                <input id="${idC}" type="text" inputmode="decimal" placeholder="Buy" value="${valC}" 
                   oninput="onInput('${m.id}', ${pidx}, ${i}, 'c', this.value)">
                <input id="${idW}" type="text" inputmode="decimal" placeholder="Win" value="${valW}" 
                   oninput="onInput('${m.id}', ${pidx}, ${i}, 'w', this.value)">
            </div>`;
        }
        return html;
    };

    const rerollBtn1 = (m.round == 1 && m.p1Id) ? `<i class="fas fa-sync-alt btn-reroll" title="Реролл" onclick="rerollMatchPlayer('${m.id}', 1)"></i>` : '';
    const rerollBtn2 = (m.round == 1 && m.p2Id) ? `<i class="fas fa-sync-alt btn-reroll" title="Реролл" onclick="rerollMatchPlayer('${m.id}', 2)"></i>` : '';

    const editBtn1 = (m.p1Id) ? `<i class="fas fa-pencil-alt btn-edit-match" title="Изм. сообщение" onclick="openEditModal('${m.p1Id}', '${m.id}')"></i>` : '';
    const editBtn2 = (m.p2Id) ? `<i class="fas fa-pencil-alt btn-edit-match" title="Изм. сообщение" onclick="openEditModal('${m.p2Id}', '${m.id}')"></i>` : '';

    let html = `
        <div class="match-top">
            <span>Match #${m.seq}</span>
            <i class="fas fa-trash btn-del-match" onclick="deleteMatch('${m.id}')"></i>
        </div>

        <div class="player-box p1-box">
            <div class="pb-header">
                <div class="pb-name-wrap">
                    <span class="pb-name" style="color:${p1.color}">${p1.name}</span>
                    ${rerollBtn1}
                    ${editBtn1}
                </div>
                <span class="pb-x x1">0x</span>
            </div>
            <div class="pb-sub" data-pid="${p1.id || ''}">${p1Msg}</div>
            <div class="pb-inputs">${genInputs(1, m.res.p1)}</div>
        </div>
    `;

    if (m.p2Id !== null) {
         html += `
            <div class="player-box p2-box">
                <div class="pb-header">
                    <div class="pb-name-wrap">
                        <span class="pb-name" style="color:${p2.color}">${p2.name}</span>
                        ${rerollBtn2}
                        ${editBtn2}
                    </div>
                    <span class="pb-x x2">0x</span>
                </div>
                <div class="pb-sub" data-pid="${p2.id || ''}">${p2Msg}</div>
                <div class="pb-inputs">${genInputs(2, m.res.p2)}</div>
            </div>
        `;
    }

    div.innerHTML = html;
    setTimeout(() => updateMatchVisualsOnly(m), 0);
    return div;
}

function drawConnectors() {
    const svg = document.getElementById('bracket-lines');
    const area = document.getElementById('tournament-area');
    
    svg.style.width = area.scrollWidth + 'px';
    svg.style.height = area.scrollHeight + 'px';
    svg.innerHTML = '';

    const areaRect = area.getBoundingClientRect();
    const scrollTop = area.scrollTop;
    const scrollLeft = area.scrollLeft;

    state.matches.forEach(m => {
        if(m.nextMatchId) {
            const currEl = document.getElementById(m.id);
            const nextEl = document.getElementById(m.nextMatchId);
            
            if(currEl && nextEl) {
                const r1 = currEl.getBoundingClientRect();
                const r2 = nextEl.getBoundingClientRect();

                const startX = (r1.right - areaRect.left) + scrollLeft;
                const startY = (r1.top + r1.height/2 - areaRect.top) + scrollTop;
                
                const endX = (r2.left - areaRect.left) + scrollLeft;
                const endY = (r2.top + r2.height/2 - areaRect.top) + scrollTop;

                const cp1 = startX + (endX - startX) * 0.5;
                const d = `M ${startX} ${startY} C ${cp1} ${startY}, ${cp1} ${endY}, ${endX} ${endY}`;

                const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                path.setAttribute("d", d);
                path.setAttribute("fill", "none");
                path.setAttribute("stroke", "#555");
                path.setAttribute("stroke-width", "2");
                svg.appendChild(path);
            }
        }
    });
}

async function connectKick(chan) {
    if(ws) ws.close();
    if(!chan) return;
    try {
        const r = await fetch(`https://kick.com/api/v2/channels/${chan}`);
        const d = await r.json();
        const cid = d.chatroom.id;
        
        ws = new WebSocket('wss://ws-us2.pusher.com/app/32cbd69e4b950bf97679?protocol=7&client=js&version=8.4.0-rc2&flash=false');
        
        ws.onopen = () => {
            document.getElementById('status-connection').textContent = '🟢 Kick Online';
            document.getElementById('status-connection').style.color = '#00ffaa';
            ws.send(JSON.stringify({event:'pusher:subscribe', data:{auth:'', channel:`chatrooms.${cid}.v2`}}));
        };
        
        ws.onmessage = (e) => {
            const m = JSON.parse(e.data);
            if(m.event === 'App\\Events\\ChatMessageEvent') {
                const data = JSON.parse(m.data);
                if(processedMsgIds.has(data.id)) return;
                processedMsgIds.add(data.id);
                
                const username = data.sender.username;
                
                if (username.toLowerCase() === 'botrix' || username.toLowerCase() === 'kickbot') return;

                const txt = data.content.replace(/\[emote:\d+:[^\]]+\]/g, '').trim();
                const color = data.sender.identity.color;
                if(txt) addParticipant(username, txt, color, false);
            }
        };
    } catch(e) { console.log(e); }
}

function launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const particles = [];
    const colors = ['#f00', '#0f0', '#00f', '#ff0', '#0ff', '#f0f', '#fff'];
    
    for(let i=0; i<200; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            vx: Math.random() * 4 - 2,
            vy: Math.random() * 4 + 2,
            c: colors[Math.floor(Math.random() * colors.length)],
            s: Math.random() * 5 + 5
        });
    }
    
    let animId;
    function draw() {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        let active = false;
        particles.forEach(p => {
            p.x += p.vx;
            p.y += p.vy;
            ctx.fillStyle = p.c;
            ctx.fillRect(p.x, p.y, p.s, p.s);
            if(p.y < canvas.height) active = true;
        });
        
        if(active) animId = requestAnimationFrame(draw);
        else cancelAnimationFrame(animId);
    }
    draw();
}

// FIX 2: Better Snow Logic (Slower, random float)
function startSnow() {
    const canvas = document.getElementById('snow-canvas');
    const ctx = canvas.getContext('2d');
    
    let width = window.innerWidth;
    let height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;

    const flakes = [];
    // Меньше снежинок, но они крупнее
    for(let i=0; i<60; i++) {
        flakes.push({
            x: Math.random() * width,
            y: Math.random() * height,
            r: Math.random() * 2 + 1.5, // Размер
            speed: Math.random() * 0.5 + 0.3, // Очень медленно
            drift: Math.random() * 1 - 0.5 // Легкое покачивание
        });
    }

    function drawSnow() {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.beginPath();
        for(let i = 0; i < flakes.length; i++) {
            const f = flakes[i];
            ctx.moveTo(f.x, f.y);
            ctx.arc(f.x, f.y, f.r, 0, Math.PI*2, true);
        }
        ctx.fill();
        moveSnow();
        requestAnimationFrame(drawSnow);
    }

    function moveSnow() {
        for(let i = 0; i < flakes.length; i++) {
            const f = flakes[i];
            f.y += f.speed;
            f.x += f.drift + Math.sin(f.y * 0.01) * 0.5; // Синусоидальное движение

            if(f.y > height) {
                flakes[i] = {
                    x: Math.random() * width, 
                    y: -10, 
                    r: f.r, 
                    speed: f.speed, 
                    drift: Math.random() * 1 - 0.5
                };
            }
        }
    }

    drawSnow();
}
