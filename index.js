//花札バトル バックエンド
const express=require('express');
const app=express();
const http=require('http').Server(app);
const io=require('socket.io')(http);

app.use(express.static('public'));


//定数

//ゲーム設定（フロントの GAME_CONFIG と値を合わせる）
const GAME_CONFIG={
    INITIAL_HP:           20,
    INITIAL_HAND:          5,
    DRAW_PER_TURN:         3,
    SUBMIT_COUNT:          3,
    DECK_REFILL_THRESHOLD:10,
};

/**各月のカード種別テンプレート（インデックス0が1月）
 * 配列順: [0番,1番,2番,3番]
 */
const CARD_TEMPLATES = [
    ['light','tan', 'kasu','kasu'],//1月
    ['tane', 'tan', 'kasu','kasu'],//2月
    ['light','tan', 'kasu','kasu'],//3月
    ['tane', 'tan', 'kasu','kasu'],//4月
    ['tane', 'tan', 'kasu','kasu'],//5月
    ['tane', 'tan', 'kasu','kasu'],//6月
    ['tane', 'tan', 'kasu','kasu'],//7月
    ['light','tane','kasu','kasu'],//8月
    ['tane', 'tan', 'kasu','kasu'],//9月
    ['tane', 'tan', 'kasu','kasu'],//10月
    ['light','tane','tan', 'kasu'],//11月
    ['light','kasu','kasu','kasu'],//12月
];

/**役名とダメージ量のテーブル
 */
const SCORE_TABLE={
    GEKKA_MUSO:   10,
    SANKO:         6,
    INOSHIKACHO:   5,
    OMOTE_SUGAWARA:5,
    TANZAKU:       5,
    HANAMIZAKE:    4,
    TSUKIMIZAKE:   4,
    MITSU_ZOROI:   3,
    SANCHO:        3,
    TSUNAGI:       2,
    KASU:          1,
};

//役判定エンジン（純粋関数のみで構成）

class GameEngine{
    /**提出された3枚のカードから役を判定する
     * @param {Array<{id:string,month:number,type:string}>} cards-提出カード（3枚）
     * @param {number}fieldMont-場の月
     * @returns {{ name:string,damage:number,isSpecial:number,bonus:number}}
     */
    static judge(cards,fieldMonth){
        if(!cards||cards.length===0){
            return{name: "役なし",damage: 0,isSpecial: 0,bonus: 0};
        }

        const months=cards.map(c=>Number(c.month));
        const types=cards.map(c=>c.type);
        const isSameMonth=months.every(m=>m===months[0]);

        const lightCount=types.filter(t=>t==='light').length;
        const taneCount=types.filter(t=>t==='tane').length;
        const tanCount=types.filter(t=>t==='tan').length;
        const kasuCount=types.filter(t=>t==='kasu').length;

        //場の月と一致するカードの枚数（ボーナス算出用）
        const fieldMonthMatchCount=months.filter(m=>m===fieldMonth).length;
        const bonus=(fieldMonthMatchCount>0&&fieldMonthMatchCount<3)
            ? fieldMonthMatchCount
            : 0;

        //デフォルト（役なし）
        let result={name: "役なし",damage: 0,isSpecial: 0,bonus };

        if(isSameMonth&&months[0]===fieldMonth){
            //月下無双：同月3枚 かつ 場の月と一致
            result={name: "月下無双",damage: SCORE_TABLE.GEKKA_MUSO,isSpecial: 1,bonus: 0};

        }else if(lightCount===3){
            result={...result,name: "三光",damage: SCORE_TABLE.SANKO};

        }else if (this.hasInoShikaCho(cards)){
            result={...result,name: "猪鹿蝶",damage: SCORE_TABLE.INOSHIKACHO};

        }else if(this.hasOmoteSugawara(cards)){
            result={...result,name: "表菅原",damage: SCORE_TABLE.OMOTE_SUGAWARA};

        }else if(tanCount===3&&this.isTanzakuSet(months)){
            result={...result,name: "短冊役",damage: SCORE_TABLE.TANZAKU};

        }else if(this.hasHanamizake(cards)){
            result={...result,name: "花見酒",damage: SCORE_TABLE.HANAMIZAKE};

        }else if(this.hasTsukimizake(cards)){
            result={...result,name: "月見酒",damage: SCORE_TABLE.TSUKIMIZAKE};

        }else if(isSameMonth){
            result={...result,name: "三つ揃い",damage: SCORE_TABLE.MITSU_ZOROI};

        }else if(taneCount===3||tanCount===3){
            result={...result,name: "三丁",damage: SCORE_TABLE.SANCHO};

        }else if(taneCount>=2||tanCount>=2){
            result={...result,name: "繋ぎ",damage: SCORE_TABLE.TSUNAGI};

        }else if(kasuCount===3){
            result={...result,name: "カス",damage: SCORE_TABLE.KASU};
        }

        return result;
    }

    /**猪鹿蝶判定（10月tane, 7月tane, 6月tane）
     * @param {Array} cards
     * @returns {boolean}
     */
    static hasInoShikaCho(cards){
        return [10,7,6].every(month=>
            cards.some(c=>c.month===month&&c.type==='tane')
        );
    }

    /**表菅原判定（1月light,2月tane,3月light）
     * @param {Array}cards
     * @returns {boolean}
     */
    static hasOmoteSugawara(cards){
        return (
            cards.some(c=>c.month===1&&c.type==='light')&&
            cards.some(c=>c.month===2&&c.type==='tane')&&
            cards.some(c=>c.month===3&&c.type==='light')
        );
    }

    /**短冊役の有効な月セット判定
     * @param {Array<number>}months
     * @returns {boolean}
     */
    static isTanzakuSet(months){
        return(
            [1,2,3].every(m=>months.includes(m))||
            [6,9,10].every(m=>months.includes(m))
        );
    }

    /**花見酒判定（3月light + 9月tane）
     * @param {Array}cards
     * @returns {boolean}
     */

    static hasHanamizake(cards){
        return(
            cards.some(c=>c.month===3&&c.type==='light')&&
            cards.some(c=>c.month===9&&c.type==='tane')
        );
    }

    /**月見酒判定（8月light + 9月tane）
     * @param {Array}cards
     * @returns {boolean}
     */
    static hasTsukimizake(cards){
        return(
            cards.some(c=>c.month===8&&c.type==='light')&&
            cards.some(c=>c.month===9&&c.type==='tane')
        );
    }
}

//デッキ生成・ユーティリティ

/**シャッフル済みのデッキを生成する
 * @returns {Array<{id:string,month:number,type:string}>}
 */
function createDeck(){
    const deck=[];
    for (let month=1;month<=12;month++){
        for (let i=0;i<4;i++){
            deck.push({
                id:   `${month}-${i}`,
                month:month,
                type: CARD_TEMPLATES[month-1][i],
            });
        }
    }
    return shuffle(deck);
}

/**配列をFisher–Yatesアルゴリズムでシャッフルする（破壊的）
 * @template T
 * @param {T[]}array
 * @returns {T[]}
 */
function shuffle(array){
    for (let i=array.length-1;i>0;i--){
        const j=Math.floor(Math.random()*(i+1));
        [array[i],array[j]]=[array[j], array[i]];
    }
    return array;
}

/**デッキ残量が閾値を下回ったとき、捨て札をシャッフルして補充する
 * @param {{ deck: Array,discardPile: Array }}room
 */
function replenishDeckIfNeeded(room){
    if(
        room.deck.length<GAME_CONFIG.DECK_REFILL_THRESHOLD&&
        room.discardPile.length>0
    ){
        room.deck.push(...shuffle(room.discardPile));
        room.discardPile=[];
    }
}

/**socket.id からルームを逆引きする
 * @param {string}socketId
 * @returns {object|null}
 */
function getRoomBySocketId(socketId){
    for (const room of rooms.values()){
        if (room.players.p1.id===socketId||room.players.p2.id===socketId){
            return room;
        }
    }
    return null;
}

/**socket.id からそのプレイヤーの role を返す
 * @param {object}room
 * @param {string}socketId
 * @returns {'p1'|'p2'|null}
 */
function getRoleBySocketId(room,socketId){
    if (room.players.p1.id===socketId){
      return 'p1';
    }
    if (room.players.p2.id === socketId){
    return 'p2';
  }
    return null;
}

//ゲーム状態ストア

/**roomId=>roomObject*/
const rooms=new Map();

// ターン処理

/**両プレイヤーがカードを提出したときのターン処理
 * @param {object}room
 */
function processTurn(room){
    const {p1,p2}=room.players;

    //役判定
    const resultP1=GameEngine.judge(room.submissions['p1'],room.fieldMonth);
    const resultP2=GameEngine.judge(room.submissions['p2'],room.fieldMonth);

    //ダメージ計算
    //特殊役（月下無双）は差分に関係なく固定ダメージを与える
    const damageToP1=resultP2.isSpecial
        ? resultP2.damage
        : Math.max(0,(resultP2.damage+resultP2.bonus)-(resultP1.damage+resultP1.bonus));

    const damageToP2=resultP1.isSpecial
        ? resultP1.damage
        : Math.max(0, (resultP1.damage+resultP1.bonus)-(resultP2.damage+resultP2.bonus));

    p1.hp-=damageToP1;
    p2.hp-=damageToP2;

    //提出カードを捨て札へ
    room.discardPile.push(...room.submissions['p1'],...room.submissions['p2']);

    //提出分を手札から除去
    p1.hand=p1.hand.filter(c=>!room.submissions['p1'].some(s=>s.id===c.id));
    p2.hand=p2.hand.filter(c=>!room.submissions['p2'].some(s=>s.id===c.id));

    //必要に応じてデッキを補充してから新カードをドロー
    replenishDeckIfNeeded(room);

    const drawnForP1=room.deck.splice(0,GAME_CONFIG.DRAW_PER_TURN);
    const drawnForP2=room.deck.splice(0,GAME_CONFIG.DRAW_PER_TURN);

    //デッキ切れ時はドローできた枚数分だけ補充（無言で壊れないようガード）
    p1.hand.push(...drawnForP1);
    p2.hand.push(...drawnForP2);

    //共通ペイロード（submissions のキーは role なので socket.id は露出しない）
    const commonPayload={
        subs: room.submissions,
        res:  { p1: resultP1,p2: resultP2 },
        hp:   { p1: p1.hp,   p2: p2.hp    },
        dc:   room.deck.length,
    };

    io.to(p1.id).emit('turn_result',{ ...commonPayload,hand: p1.hand});
    io.to(p2.id).emit('turn_result',{ ...commonPayload,hand: p2.hand});

    room.submissions={};
}

// Socket.io イベントハンドラ
io.on('connection',socket=>{

    //ルーム参加
    socket.on('join',data=>{
        try {
            const roomId=data.roomId||"default";

            //ルームが存在しない場合は新たに作成
            if (!rooms.has(roomId)){
                rooms.set(roomId,{
                    id: roomId,
                    deck: createDeck(),
                    discardPile: [],
                    players: {
                        p1: { id: null,hp: GAME_CONFIG.INITIAL_HP,hand: []},
                        p2: { id: null,hp: GAME_CONFIG.INITIAL_HP,hand: []},
                    },
                    submissions: {},
                    fieldMonth: Math.floor(Math.random()*12)+1,
                    status: 'waiting',
                });
            }

            const room=rooms.get(roomId);

            //role を割り当て（空きスロットがなければ入室拒否）
            let role=null;
            if(room.players.p1.id === null){
              role = 'p1';
            }
            else if(room.players.p2.id === null) {
              role = 'p2';
          }

            if(!role){
                socket.emit('error_msg','Room Full');
                return;
            }

            room.players[role].id=socket.id;
            socket.join(roomId);
            socket.emit('role_assigned',role);

            //2人揃ったらゲーム開始
            if(room.players.p1.id&&room.players.p2.id&&room.status==='waiting'){
                room.status='playing';
                room.players.p1.hand=room.deck.splice(0,GAME_CONFIG.INITIAL_HAND);
                room.players.p2.hand=room.deck.splice(0,GAME_CONFIG.INITIAL_HAND);

                io.to(room.players.p1.id).emit('game_start',{
                    fieldMonth: room.fieldMonth,
                    hand:       room.players.p1.hand,
                    deckCount:  room.deck.length,
                });
                io.to(room.players.p2.id).emit('game_start',{
                    fieldMonth: room.fieldMonth,
                    hand:       room.players.p2.hand,
                    deckCount:  room.deck.length,
                });
            }

        } catch (err){
            console.error("[join] Error:",err);
        }
    });

    // 攻撃（カード提出）
    socket.on('submit_attack',cards=>{
        try{
            const room=getRoomBySocketId(socket.id);
            if (!room||room.status!=='playing'){
               return;
             }

            const role=getRoleBySocketId(room,socket.id);

            //サーバー側バリデーション：提出枚数チェック
            if(!Array.isArray(cards)||cards.length!==GAME_CONFIG.SUBMIT_COUNT){
                socket.emit('error_msg','Invalid Card Count');
                return;
            }

            //サーバー側バリデーション：手札に存在するカードか
            const isValidCards=cards.every(submitted=>
                room.players[role].hand.some(handCard=>handCard.id===submitted.id)
            );
            if(!isValidCards){
                socket.emit('error_msg','Invalid Cards');
                return;
            }

            //roleキーで保存（socket.idをキーにしない）
            room.submissions[role]=cards;

            const submittedCount=Object.keys(room.submissions).length;
            if(submittedCount===2){
                processTurn(room);
            }else{
                socket.to(room.id).emit('wait_opponent');
            }

        }catch(err){
            console.error("[submit_attack] Error:",err);
        }
    });

    //引き直し
    socket.on('redraw',cardIds=>{
        try{
            const room=getRoomBySocketId(socket.id);
            if(!room){
              return;
            }

            const role=getRoleBySocketId(room, socket.id);
            const player=room.players[role];

            //バリデーション：引き直し対象が手札に存在するか
            const isValidIds=cardIds.every(id=>
                player.hand.some(handCard=>handCard.id===id)
            );
            if(!isValidIds){
              return;
            }

            //引き直し対象を捨て札へ移動
            const discarded=player.hand.filter(c=>cardIds.includes(c.id));
            player.hand    =player.hand.filter(c=>!cardIds.includes(c.id));
            room.discardPile.push(...discarded);

            //デッキ補充チェック後にドロー
            replenishDeckIfNeeded(room);
            const drawnCards=room.deck.splice(0,cardIds.length);
            player.hand.push(...drawnCards);

            socket.emit('redraw_done', {
                hand:      player.hand,
                deckCount: room.deck.length,
            });

        }catch (err){
            console.error("[redraw] Error:",err);
        }
    });

    //切断
    socket.on('disconnect',()=>{
        const room=getRoomBySocketId(socket.id);
        if(!room){
          return;
        }

        const role=getRoleBySocketId(room,socket.id);
        if(role){
          room.players[role].id=null;
        }

        //両プレイヤーが抜けたらルームを削除、片方だけなら待機状態に戻す
        const isEmpty=!room.players.p1.id&&!room.players.p2.id;
        if(isEmpty){
            rooms.delete(room.id);
        }else{
            room.status='waiting';
        }
    });
});

// サーバー起動
const PORT=process.env.PORT||3000;
http.listen(PORT,()=>console.log(`花札バトルサーバー起動: port ${PORT}`));
