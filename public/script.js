const socket=io();

//UI Elements Cache
const UI={
    playerHand: document.getElementById('p-h'),
    cpuHand: document.getElementById('c-h'),
    log: document.getElementById('log'),
    phpV: document.getElementById('php-v'),
    chpV: document.getElementById('chp-v'),
    phpF: document.getElementById('php-f'),
    chpF: document.getElementById('chp-f'),
    deckCount: document.getElementById('dc'),
    fieldMonth: document.getElementById('fm-n'),
    attackBtn: document.getElementById('a-btn'),
    redrawBtn: document.getElementById('r-btn')
};

const STATE={
    role: "",hand: [],fieldMonth: 1,
    hp: { me: 20, opp: 20 },selected: new Set(),
    isGameOver: false,hasRedrawn: false
};

const MONTHS=["","松","梅","桜","藤","菖","牡丹","萩","月","菊","紅葉","柳","桐"];

/*通信イベント*/
socket.emit('join',{roomId: "default" });

socket.on('role_assigned', role=>{
    STATE.role=role;
    updateMessage(`Joined as ${role.toUpperCase()}. Waiting...`);
});

socket.on('game_start',data=>{
    STATE.fieldMonth=data.fieldMonth;
    STATE.hand=data.hand;
    UI.fieldMonth.innerText=`${STATE.fieldMonth}(${MONTHS[STATE.fieldMonth]})`;
    UI.deckCount.innerText=data.deckCount;
    STATE.isGameOver=false;
    STATE.hasRedrawn=false;
    refresh();
    updateMessage("3枚選んで攻撃！");
});

socket.on('turn_result',async data=>{
    //相手のカード表示
    const oppRole=STATE.role==='p1'?'p2' : 'p1';
    const oppCards=data.subs[Object.keys(data.subs).find(id=>id!==socket.id)];
    renderOpponent(oppCards);

    const myRes=data.res[STATE.role];
    const oppRes=data.res[oppRole];
    updateMessage(`【${myRes.name} vs ${oppRes.name}】`);

    //HP更新
    await new Promise(r=>setTimeout(r,1000));
    STATE.hp.me=data.hp[STATE.role];
    STATE.hp.opp=data.hp[oppRole];
    updateUI();

    if(STATE.hp.me<=0||STATE.hp.opp<=0){
        STATE.isGameOver = true;
        updateMessage(STATE.hp.opp<=0?"YOU WIN!" : "GAME OVER");
        return;
    }

    await new Promise(r=>setTimeout(r,1500));
    STATE.hand=data.hand;
    STATE.selected.clear();
    STATE.hasRedrawn=false;
    UI.deckCount.innerText=data.dc;
    refresh();
    UI.attackBtn.disabled=UI.redrawBtn.disabled=false;
});

socket.on('redraw_done',data=>{
    STATE.hand=data.hand;
    UI.deckCount.innerText=data.deckCount;
    STATE.selected.clear();
    STATE.hasRedrawn=true;
    UI.redrawBtn.disabled=true;
    refresh();
});


 //描画・操作
function refresh(){
    UI.playerHand.innerHTML='';
    STATE.hand.forEach(c=>{
        const div=document.createElement('div');
        div.className=`cd ${STATE.selected.has(c.id)?'sel' : ''} ${c.month===STATE.fieldMonth?'hl' : ''}`;
        div.innerHTML=`<div class="ml">${c.month}</div><div class="tl">${c.type}</div>`;
        div.onclick=()=>{
            if (STATE.isGameOver)return;
            STATE.selected.has(c.id)?STATE.selected.delete(c.id) : STATE.selected.add(c.id);
            refresh();
        };
        UI.playerHand.appendChild(div);
    });
    renderOpponent();
}

function renderOpponent(cards=null){
    UI.cpuHand.innerHTML='';
    if (cards){
        cards.forEach(c=>{
            const div=document.createElement('div');
            div.className=`cd cpu ${c.month===STATE.fieldMonth?'hl' : ''}`;
            div.innerHTML=`<div class="ml">${c.month}</div><div class="tl">${c.type}</div>`;
            UI.cpuHand.appendChild(div);
        });
    } else {
        for (let i=0;i<3;i++) {
            const div=document.createElement('div');
            div.className='cd cpu';
            div.style.background='#444';
            UI.cpuHand.appendChild(div);
        }
    }
}

function updateUI(){
    UI.phpV.innerText=Math.max(0, STATE.hp.me);
    UI.chpV.innerText=Math.max(0, STATE.hp.opp);
    UI.phpF.style.width=(Math.max(0, STATE.hp.me)/20*100)+"%";
    UI.chpF.style.width=(Math.max(0, STATE.hp.opp)/20*100)+"%";
}

function updateMessage(t){ UI.log.innerHTML=t;}

//攻撃実行（カード提出）
 
function executeAttack(){
    //1.バリデーション（3枚選択されていない、またはゲーム終了時は何もしない）
    if (STATE.selected.size!==3||STATE.isGameOver)return;

    //2. 送信データの準備
    const cards=STATE.hand.filter(c=>STATE.selected.has(c.id));

    //3.UIの視覚的な更新（ユーザーへのフィードバック）
    updateMessage(`
        <div style="text-align: center; padding: 10px;">
            <strong style="color: #ffd700; font-size: 1.1em;">カードを出しました</strong><br>
            <span class="wait-dots" style="color: #aaa;">相手の選択を待っています</span>
        </div>
    `);

    // 4.二重送信防止と操作制限
    UI.attackBtn.disabled=true;
    UI.redrawBtn.disabled=true;

    //手札エリアをロック（CSSで暗くしたり触れなくしたりする用）
    UI.playerHand.classList.add('locked');

    //5.サーバーへ送信
    socket.emit('submit_attack',cards);
}

function redraw(){
    if (STATE.hasRedrawn||STATE.isGameOver||STATE.selected.size===0)return;
    socket.emit('redraw', Array.from(STATE.selected));
}


socket.on('turn_result',async data=>{
    const oppRole=STATE.role==='p1'?'p2' : 'p1';
    const oppCards=data.subs[Object.keys(data.subs).find(id=>id!==socket.id)];

    //1.相手のカードを公開
    renderOpponent(oppCards);
    updateMessage("判定中...");

    //2.役とスコアの解析
    const myRes=data.res[STATE.role];
    const oppRes=data.res[oppRole];
    const myTotal=myRes.damage+myRes.bonus;
    const oppTotal=oppRes.damage+oppRes.bonus;

    //3.詳細なリザルト表示（HTMLで構造化）
    let resultHTML= `
        <div style="border-bottom: 1px solid #555; padding-bottom: 5px; margin-bottom: 5px;">
            <span style="color: #4d94ff;">YOU: ${myRes.name} (${myTotal}点)</span><br>
            <span style="color: #ff4d4d;">OPP: ${oppRes.name} (${oppTotal}点)</span>
        </div>
    `;

    //HPの変動計算
    const damageToMe=STATE.hp.me-data.hp[STATE.role];
    const damageToOpp=STATE.hp.opp-data.hp[oppRole];

    //ダメージ結果の判定メッセージ
    if(damageToOpp>0&&damageToMe===0){
        resultHTML+=`<strong style="color: #ff4d4d; font-size: 1.2em;">勝利！ ${damageToOpp}のダメージを与えた！</strong>`;
    } else if(damageToMe>0&&damageToOpp===0) {
        resultHTML+=`<strong style="color: #4d94ff; font-size: 1.2em;">敗北... ${damageToMe}のダメージを受けた</strong>`;
    } else if(damageToOpp > 0 && damageToMe > 0) {
        resultHTML+=`<strong style="color: #ffff00; font-size: 1.2em;">相打ち！ 互いにダメージ！</strong>`;
    } else{
        resultHTML+=`<span style="color: #aaa;">引き分け：ダメージなし</span>`;
    }

    updateMessage(resultHTML);

    //4. HPゲージの減少演出
    await new Promise(r=>setTimeout(r,1200));
    STATE.hp.me=data.hp[STATE.role];
    STATE.hp.opp=data.hp[oppRole];
    updateUI();

    //5.決着判定
    if(STATE.hp.me<=0||STATE.hp.opp<=0){
        STATE.isGameOver=true;
        await new Promise(r=>setTimeout(r,500));
        if(STATE.hp.opp<=0 && STATE.hp.me<=0) {
            updateMessage("<h1 style='color: #ffff00;'>DRAW (相打ち)</h1>");
        } else if(STATE.hp.opp<=0){
            updateMessage("<h1 style='color: #ffd700; text-shadow: 0 0 10px gold;'>YOU WIN!!</h1>");
        } else{
            updateMessage("<h1 style='color: #4d94ff;'>GAME OVER</h1>");
        }
        return;
    }

    //6.次のターンへの移行案内
    await new Promise(r=>setTimeout(r,2000));
    updateMessage("<span style='color: #00ff00;'>── 次のターン開始 ──</span><br>カードを3枚選択してください");

    //状態更新
    STATE.hand=data.hand;
    STATE.selected.clear();
    STATE.hasRedrawn=false;
    UI.deckCount.innerText=data.dc;
    refresh();

    // 操作有効化
    UI.attackBtn.disabled=UI.redrawBtn.disabled=false;
});

//モーダル制御

//モーダルの表示・非表示を切り替える
 
function toggleRuleModal() {
    const modal=document.getElementById('rule-modal');
    if(!modal)return;

    // 現在のスタイルを見て表示・非表示を切り替え
    if(modal.style.display==='flex') {
        modal.style.display='none';
    } else{
        modal.style.display='flex';
    }
}

/**タブを切り替える
 * @param {string} tabId 表示したいタブのID ('tab-how' か 'tab-yaku')
 */
function switchTab(tabId){
    //1.すべてのタブボディを一旦非表示にする
    const tabs = document.querySelectorAll('.tab-body');
    tabs.forEach(tab=>{
        tab.style.display='none';
    });

    //2.指定されたIDのタブだけ表示する
    const targetTab=document.getElementById(tabId);
    if(targetTab){
        targetTab.style.display='block';
    }


}
