const socket=io();

//定数

//ゲーム設定
const GAME_CONFIG={
    INITIAL_HP:  20,
    SUBMIT_COUNT:3,
};

//月の読み仮名テーブル（インデックス0は未使用）
const MONTHS=["","松","梅","桜","藤","菖","牡丹","萩","月","菊","紅葉","柳","桐"];


//UIキャッシュ（DOMの参照はここに集約）
const UI={
    playerHand:    document.getElementById('p-h'),
    cpuHand:       document.getElementById('c-h'),
    log:           document.getElementById('log'),
    playerHpValue: document.getElementById('php-v'),
    cpuHpValue:    document.getElementById('chp-v'),
    playerHpFill:  document.getElementById('php-f'),
    cpuHpFill:     document.getElementById('chp-f'),
    deckCount:     document.getElementById('dc'),
    fieldMonthName:document.getElementById('fm-n'),
    attackBtn:     document.getElementById('a-btn'),
    redrawBtn:     document.getElementById('r-btn'),
};

//ゲーム状態
const STATE={
    role:      "",
    hand:      [],
    fieldMonth:1,
    hp:        {me: GAME_CONFIG.INITIAL_HP,opp: GAME_CONFIG.INITIAL_HP},
    selected:  new Set(),
    isGameOver:false,
    hasRedrawn:false,
};


/**ユーティリティ
 *指定ミリ秒待機するPromiseを返す
 *@param {number}ms-ミリ秒
 *@returns {Promise<void>}
 */

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/**ログエリアにメッセージを表示する
 *@param {string}html-表示するHTML文字列
 */
function updateMessage(html){
    UI.log.innerHTML=html;
}

//通信イベント
socket.emit('join',{roomId: "default"});

socket.on('role_assigned',role=>{
    STATE.role=role;
    updateMessage(`Joined as ${role.toUpperCase()}.Waiting...`);
});

socket.on('game_start',data=>{
    STATE.fieldMonth=data.fieldMonth;
    STATE.hand=data.hand;
    STATE.isGameOver=false;
    STATE.hasRedrawn=false;

    UI.fieldMonthName.innerText=`${STATE.fieldMonth}（${MONTHS[STATE.fieldMonth]}）`;
    UI.deckCount.innerText=data.deckCount;

    //HPを初期値にリセット
    STATE.hp.me=GAME_CONFIG.INITIAL_HP;
    STATE.hp.opp=GAME_CONFIG.INITIAL_HP;
    updateUI();

    refresh();
    updateMessage("3枚選んで攻撃！");
});


 //ターン結果受信
socket.on('turn_result',async data=>{
    const oppRole=STATE.role==='p1'?'p2' : 'p1';

    //roleキーで相手カードを取得
    const oppCards=data.subs[oppRole];
    const myRes   =data.res[STATE.role];
    const oppRes  =data.res[oppRole];

    //相手カードを公開し、結果を表示
    renderOpponent(oppCards);
    updateMessage(buildResultHTML(myRes,oppRes,data.hp,oppRole));

    //HPゲージ減少演出
    await delay(1200);
    applyHpUpdate(data.hp,oppRole);

    //決着判定
    if(STATE.hp.me<=0||STATE.hp.opp<=0) {
        await delay(500);
        handleGameOver();
        return;
    }

    //次ターンへ移行
    await delay(2000);
    proceedToNextTurn(data);
});

socket.on('redraw_done',data=>{
    STATE.hand=data.hand;
    STATE.hasRedrawn=true;

    UI.deckCount.innerText=data.deckCount;
    UI.redrawBtn.disabled =true;

    STATE.selected.clear();
    refresh();
});

//ターン結果ヘルパー関数

/**ターン結果のHTMLを生成する
 * @param {object} myRes -自分の役判定結果
 * @param {object} oppRes-相手の役判定結果
 * @param {object} hpData-新しいHPデータ {p1,p2}
 * @param {string} oppRole-相手のrole ('p1'or'p2')
 * @returns {string}HTML文字列
 */

function buildResultHTML(myRes,oppRes,hpData,oppRole){
    const myTotal=myRes.damage+myRes.bonus;
    const oppTotal=oppRes.damage+oppRes.bonus;

    const newMyHp=hpData[STATE.role];
    const newOppHp=hpData[oppRole];
    const damageToMe=STATE.hp.me-newMyHp;
    const damageToOpp=STATE.hp.opp-newOppHp;

    let outcomeMsg;
    if(damageToOpp>0&&damageToMe===0){
        outcomeMsg=`<strong style="color:#ff4d4d;font-size:1.2em;">勝利！${damageToOpp}ダメージを与えた！</strong>`;
    }else if(damageToMe>0&&damageToOpp===0){
        outcomeMsg=`<strong style="color:#4d94ff;font-size:1.2em;">敗北… ${damageToMe}ダメージを受けた</strong>`;
    }else if(damageToOpp>0&&damageToMe>0){
        outcomeMsg=`<strong style="color:#ffff00;font-size:1.2em;">相打ち！</strong>`;
    }else{
        outcomeMsg=`<span style="color:#aaa;">引き分け：ダメージなし</span>`;
    }

    return `
        <div style="border-bottom:1px solid #555;padding-bottom:5px;margin-bottom:5px;">
            <span style="color:#4d94ff;">YOU: ${myRes.name}（${myTotal}点）</span><br>
            <span style="color:#ff4d4d;">OPP: ${oppRes.name}（${oppTotal}点）</span>
        </div>
        ${outcomeMsg}
    `;
}

/**HP状態を更新し、UIに反映する
 * @param {object}hpData-新しいHPデータ {p1,p2}
 * @param {string}oppRole-相手のrole('p1'or'p2')
 */

function applyHpUpdate(hpData,oppRole){
    STATE.hp.me =hpData[STATE.role];
    STATE.hp.opp=hpData[oppRole];
    updateUI();
}


 //ゲーム終了メッセージを表示し、状態をロックする

function handleGameOver(){
    STATE.isGameOver=true;

    if(STATE.hp.me<=0&&STATE.hp.opp<=0){
        updateMessage("<h1 style='color:#ffff00;'>DRAW</h1>");
    }else if(STATE.hp.opp<=0){
        updateMessage("<h1 style='color:#ffd700;text-shadow:0 0 10px gold;'>YOU WIN!!</h1>");
    }else{
        updateMessage("<h1 style='color:#4d94ff;'>GAME OVER</h1>");
    }
}

/**次ターンの開始処理（手札更新・UI有効化）
 * @param {object} data-turn_result イベントのデータ
 */
function proceedToNextTurn(data){
    STATE.hand      =data.hand;
    STATE.hasRedrawn=false;
    STATE.selected.clear();

    UI.deckCount.innerText=data.dc;
    UI.attackBtn.disabled =false;
    UI.redrawBtn.disabled =false;

    renderOpponent(null);
    refresh();
    updateMessage("<span style='color:#00ff00;'>── 次のターン開始 ──</span><br>カードを3枚選択してください");
}

//描画関数

 //自分の手札を再描画する

function refresh(){
    UI.playerHand.innerHTML='';
    UI.playerHand.classList.remove('locked');

    STATE.hand.forEach(card=>{
        const div=document.createElement('div');
        const isSelected  =STATE.selected.has(card.id);
        const isFieldMonth=card.month===STATE.fieldMonth;

        div.className=`cd${isSelected?' sel' : ''}${isFieldMonth ? ' hl' : ''}`;
        div.innerHTML=`<div class="ml">${card.month}</div><div class="tl">${card.type}</div>`;

        div.onclick=()=>{
            if(STATE.isGameOver){
              return;
            }
            if(STATE.selected.has(card.id)){
                STATE.selected.delete(card.id);
            } else{
                STATE.selected.add(card.id);
            }
            refresh();
        };

        UI.playerHand.appendChild(div);
    });

    //相手エリアが空のときは伏せカードを表示
    if(UI.cpuHand.children.length===0) {
        renderOpponent(null);
    }
}

/**相手の手札エリアを描画する
 * @param {Array|null}cards-公開するカード配列。null なら伏せカードを表示
 */
function renderOpponent(cards=null){
    UI.cpuHand.innerHTML='';

    if(cards){
        cards.forEach(card=>{
            const div=document.createElement('div');
            div.className=`cd cpu${card.month===STATE.fieldMonth?' hl' : ''}`;
            div.innerHTML=`<div class="ml">${card.month}</div><div class="tl">${card.type}</div>`;
            UI.cpuHand.appendChild(div);
        });
    }else{
        //伏せカードをSUBMIT_COUNT枚表示
        for(let i=0;i<GAME_CONFIG.SUBMIT_COUNT;i++) {
            const div=document.createElement('div');
            div.className='cd cpu';
            div.style.background='#444';
            UI.cpuHand.appendChild(div);
        }
    }
}

//HPゲージとHP数値をUIに反映する
function updateUI(){
    const myHp =Math.max(0,STATE.hp.me);
    const oppHp=Math.max(0,STATE.hp.opp);

    UI.playerHpValue.innerText =myHp;
    UI.cpuHpValue.innerText    =oppHp;
    UI.playerHpFill.style.width=(myHp /GAME_CONFIG.INITIAL_HP*100)+'%';
    UI.cpuHpFill.style.width   =(oppHp/GAME_CONFIG.INITIAL_HP*100)+'%';
}

// ユーザー操作

/**攻撃実行（カード提出）
 *攻撃ボタンから呼び出される
 */
function executeAttack(){
    if(STATE.isGameOver){
      return;
    }
    if(STATE.selected.size!==GAME_CONFIG.SUBMIT_COUNT){
      return;
    }
    const selectedCards=STATE.hand.filter(c=>STATE.selected.has(c.id));

    //UIを送信中の状態にロック
    UI.attackBtn.disabled=true;
    UI.redrawBtn.disabled=true;
    UI.playerHand.classList.add('locked');

    updateMessage(`
        <div style="text-align:center;padding:10px;">
            <strong style="color:#ffd700;font-size:1.1em;">カードを出しました</strong><br>
            <span style="color:#aaa;">相手の選択を待っています…</span>
        </div>
    `);

    socket.emit('submit_attack',selectedCards);
}

/**手札の引き直し
 *引き直しボタンから呼び出される
 */
function redraw(){
    if(STATE.isGameOver){
      return;
    }
    if(STATE.hasRedrawn){
      return;
    }
    if(STATE.selected.size===0){
      return;
    }
    socket.emit('redraw', Array.from(STATE.selected));
}

// モーダル制御
 //ルール説明モーダルの表示・非表示を切り替える
function toggleRuleModal(){
    const modal=document.getElementById('rule-modal');
    if (!modal){
      return;
    }
    modal.style.display=modal.style.display==='flex'?'none' : 'flex';
}

/**モーダル内のタブを切り替える
 * @param {string}tabId-表示するタブのID ('tab-how' or 'tab-yaku')
 */
function switchTab(tabId){
    document.querySelectorAll('.tab-body').forEach(tab=>{
        tab.style.display='none';
    });

    const targetTab=document.getElementById(tabId);
    if(targetTab){
    targetTab.style.display='block';
  }
}
