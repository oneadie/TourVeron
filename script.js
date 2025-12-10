const STATE_KEY = 'tourveron_v6_data'; 
const REEL_ITEM_HEIGHT = 60; 
const REEL_WINDOW_HEIGHT = 180; 

let state = {
    settings: { method: 'kick', channel: '', limit: 50 },
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

window.onload = () => {
    loadState();
    setupEvents();
    if (state.isStarted) {
        restoreSession();
    } else {
        updateUIFromSettings();
    }
    
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
        addParticipant(name, msg, '#ffffff');
        hideModal('add-modal');
    }
}

function openEditModal(id) {
    const p = state.participants.find(x => x.id === id);
    if(!p) return;
    document.getElementById('edit-id').value = id;
    document.getElementById('edit-msg').value = p.msg;
    showModal('edit-modal');
}

function confirmEditParticipant() {
    const id = document.getElementById('edit-id').value;
    const msg = document.getElementById('edit-msg').value;
    const p = state.participants.find(x => x.id === id);
    if(p) {
        p.msg = msg;
        saveState();
        renderParticipants();
        renderBracket();
        hideModal('edit-modal');
    }
}

function saveState() { localStorage.setItem(STATE_KEY, JSON.stringify(state)); }
function loadState() {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
        try {
            state = JSON.parse(raw);
            if (!state.roundBonuses) state.roundBonuses = {};
        } catch(e) { console.error("Save load error", e); }
    }
}

function updateUIFromSettings() {
    const s = state.settings;
    document.getElementById('setting-method').value = s.method;
    document.getElementById('setting-channel').value = s.channel;
    document.getElementById('setting-limit').value = s.limit;
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
            addParticipant(bufferName, msg, '#ccc');
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

function addParticipant(name, msg, color) {
    if (!state.isMonitoring && state.settings.method === 'kick') {
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

    runRouletteAnim(available, p1, p2).then(() => {
        createMatch(1, p1.id, p2.id);
    });
}

function runRouletteAnim(pool, w1, w2) {
    return new Promise(resolve => {
        const modal = document.getElementById('roulette-modal');
        const sL = document.getElementById('strip-left');
        const sR = document.getElementById('strip-right');
        modal.classList.remove('hidden');

        const WIN_INDEX = 24; 
        const TOTAL_ITEMS = 35;

        const buildStrip = (winner) => {
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

        sL.innerHTML = buildStrip(w1);
        sR.innerHTML = buildStrip(w2);

        sL.style.transition = 'none'; sL.style.transform = 'translateY(0)';
        sR.style.transition = 'none'; sR.style.transform = 'translateY(0)';

        const centerOffset = (REEL_WINDOW_HEIGHT / 2) - ((WIN_INDEX * REEL_ITEM_HEIGHT) + (REEL_ITEM_HEIGHT / 2));
        
        setTimeout(() => {
            const css = `transform 4s cubic-bezier(0.15, 0.9, 0.3, 1)`;
            sL.style.transition = css;
            sR.style.transition = css;
            
            sL.style.transform = `translateY(${centerOffset}px)`;
            sR.style.transform = `translateY(${centerOffset}px)`;
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
}

function onInput(matchId, pIdx, bonusIdx, field, val) {
    const match = state.matches.find(m => m.id === matchId);
    if (!match) return;

    if (pIdx === 1) match.res.p1[bonusIdx][field] = val;
    else match.res.p2[bonusIdx][field] = val;
    
    updateMatchVisualsOnly(match);

    clearTimeout(inputDebounceTimer);
    inputDebounceTimer = setTimeout(() => {
        saveState();
        checkWinner(match);
    }, 600);
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
    
    const x1 = calculateScore(match.res.p1, count).toFixed(1);
    const x2 = calculateScore(match.res.p2, count).toFixed(1);

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
        if (parseFloat(x1) > parseFloat(x2)) {
            p1Box.classList.add('winner'); p2Box.classList.add('loser');
        } else if (parseFloat(x2) > parseFloat(x1)) {
            p2Box.classList.add('winner'); p1Box.classList.add('loser');
        }
    }
}

function checkWinner(match) {
    const count = getBonusCount(match.round);

    if (!match.p2Id) {
        let hasData = false;
        for(let i=0; i<count; i++) if(match.res.p1[i].c!=='' && match.res.p1[i].w!=='') hasData = true;

        if(hasData) {
            if (match.winnerId !== match.p1Id) {
                match.winnerId = match.p1Id;
                saveState();
                propagateWinner(match);
            }
        }
        return;
    }

    if(hasAnyData(match.res.p1, match.res.p2, count)) {
        const x1 = calculateScore(match.res.p1, count);
        const x2 = calculateScore(match.res.p2, count);
        
        let newWinner = null;
        if(x1 > x2) newWinner = match.p1Id;
        else if(x2 > x1) newWinner = match.p2Id;

        if (newWinner && newWinner !== match.winnerId) {
            match.winnerId = newWinner;
            saveState();
            propagateWinner(match);
        }
    }
}

function propagateWinner(finishedMatch) {
    const winnerObj = state.participants.find(p=>p.id === finishedMatch.winnerId);
    const winnerName = winnerObj?.name || 'Unknown';
    const winnerMsg = winnerObj?.msg || '...';

    if (finishedMatch.nextMatchId) {
        const next = state.matches.find(m => m.id === finishedMatch.nextMatchId);
        if(next) {
            const oldP1 = next.p1Id;
            const oldP2 = next.p2Id;
            
            if(oldP1 === null || oldP1 === finishedMatch.p1Id || oldP1 === finishedMatch.p2Id) {
                next.p1Id = finishedMatch.winnerId;
            } else if (oldP2 === null || oldP2 === finishedMatch.p1Id || oldP2 === finishedMatch.p2Id) {
                next.p2Id = finishedMatch.winnerId;
            } else {
                if(next.p1Id === null) next.p1Id = finishedMatch.winnerId;
                else next.p2Id = finishedMatch.winnerId;
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
        if (isTargetP1) targetMatch.p1Id = finishedMatch.winnerId;
        else targetMatch.p2Id = finishedMatch.winnerId;
        
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
            p1Id: isTargetP1 ? finishedMatch.winnerId : null,
            p2Id: isTargetP1 ? null : finishedMatch.winnerId,
            res: { p1: JSON.parse(JSON.stringify(empty)), p2: JSON.parse(JSON.stringify(empty)) },
            winnerId: null, 
            nextMatchId: null,
            bracketSlot: targetSlot
        };

        if (!pendingInCurrentRound && !matchesInNextRound && finishedMatch.round > 1) {
             document.getElementById('winner-name-display').textContent = winnerName;
             document.getElementById('winner-msg-display').textContent = winnerMsg;
             showModal('winner-modal');
             return;
        }

        state.matches.push(newMatch);
        finishedMatch.nextMatchId = newMatch.id;
        saveState();
        renderBracket();
    }
}

function renderBracket() {
    const area = document.getElementById('tournament-area');
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

    setTimeout(() => {
        drawConnectors();
    }, 0);
}

function createMatchHTML(m) {
    const div = document.createElement('div');
    div.className = 'match-card';
    div.id = m.id;

    const p1 = state.participants.find(p=>p.id===m.p1Id) || {name:'Ожидание...', msg:'...', color:'#555'};
    const p2 = m.p2Id ? (state.participants.find(p=>p.id===m.p2Id) || {name:'Ожидание...', msg:'...', color:'#555'}) : null;

    const bonusesCount = getBonusCount(m.round);

    const genInputs = (pidx, resArr) => {
        let html = '';
        for(let i=0; i<bonusesCount; i++) {
            const valC = resArr[i] ? resArr[i].c : '';
            const valW = resArr[i] ? resArr[i].w : '';
            html += `
            <div class="inputs-row">
                <input type="number" placeholder="Buy" value="${valC}" 
                   oninput="onInput('${m.id}', ${pidx}, ${i}, 'c', this.value)">
                <input type="number" placeholder="Win" value="${valW}" 
                   oninput="onInput('${m.id}', ${pidx}, ${i}, 'w', this.value)">
            </div>`;
        }
        return html;
    };

    let html = `
        <div class="match-top">
            <span>Match #${m.seq}</span>
            <i class="fas fa-trash btn-del-match" onclick="deleteMatch('${m.id}')"></i>
        </div>

        <div class="player-box p1-box">
            <div class="pb-header">
                <span class="pb-name" style="color:${p1.color}">${p1.name}</span>
                <span class="pb-x x1">0x</span>
            </div>
            <div class="pb-sub">${p1.msg}</div>
            <div class="pb-inputs">${genInputs(1, m.res.p1)}</div>
        </div>
    `;

    if (m.p2Id !== null) {
         html += `
            <div class="player-box p2-box">
                <div class="pb-header">
                    <span class="pb-name" style="color:${p2.color}">${p2.name}</span>
                    <span class="pb-x x2">0x</span>
                </div>
                <div class="pb-sub">${p2.msg}</div>
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
                if(txt) addParticipant(username, txt, color);
            }
        };
    } catch(e) { console.log(e); }
}
