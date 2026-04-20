
const express=require('express');
const app=express();
const http=require('http').Server(app);
const io=require('socket.io')(http);

app.use(express.static('public'));

//定数管理（環境変数での管理が望ましいが、今回は分かりやすさ優先）
const CARD_TEMPLATES=[
    ['light','tan','kasu','kasu'],['tane','tan','kasu','kasu'],
    ['light','tan','kasu','kasu'],['tane','tan','kasu','kasu'],
    ['tane','tan','kasu','kasu'],['tane','tan','kasu','kasu'],
    ['tane','tan','kasu','kasu'],['light','tane','kasu','kasu'],
    ['tane','tan','kasu','kasu'],['tane','tan','kasu','kasu'],
    ['light','tane','tan','kasu'],['light','kasu','kasu','kasu']
];

const SCORE_TABLE={
    GEKKA_MUSO: 10,SANKO: 6,INOSHIKACHO: 5,OMOTE_SUGAWARA: 5,
    TANZAKU: 5,HANAMIZAKE: 4,TSUKIMIZAKE: 4,MITSU_ZOROI: 3,
    SANCHO: 3,TSUNAGI: 2,KASU: 1
};

//役判定ロジック
class GameEngine{
    static judge(cards, fieldMonth){
        if(!cards||cards.length===0)return{
          name: "役なし",damage: 0,isSpecial: 0,bonus: 0
        };
        const months=cards.map(c=>Number(c.month));
        const types=cards.map(c=>c.type);
        const isSameMonth=months.every(m=>m==months[0]);
        const lightCount=types.filter(t=>t=='light').length;
        const taneCount=types.filter(t=>t=='tane').length;
        const tanCount=types.filter(t=>t=='tan').length;
        const kasuCount=types.filter(t=>t=='kasu').length;
        const fieldMonthMatch=months.filter(m=>m==fieldMonth).length;

        let res={name: "役なし",damage: 0,isSpecial: 0,bonus: (fieldMonthMatch>0&&fieldMonthMatch<3)?fieldMonthMatch : 0};

        if(isSameMonth && months[0]==fieldMonth) res={ name: "月下無双",damage: SCORE_TABLE.GEKKA_MUSO,isSpecial: 1,bonus: 0};
        else if(lightCount==3) res={...res,name: "三光",damage: SCORE_TABLE.SANKO};
        else if(this.hasInoShikaCho(cards)) res={...res,name: "猪鹿蝶",damage: SCORE_TABLE.INOSHIKACHO};
        else if(this.hasOmoteSugawara(cards)) res={...res,name: "表菅原",damage: SCORE_TABLE.OMOTE_SUGAWARA};
        else if(tanCount==3&&this.isTanzakuSet(months)) res={...res,name: "短冊役",damage: SCORE_TABLE.TANZAKU};
        else if(this.hasMatch(cards,3,'light',9,'tane'))res={...res,name: "花見酒",damage: SCORE_TABLE.HANAMIZAKE};
        else if(this.hasMatch(cards, 8, 'light', 9, 'tane')) res = { ...res, name: "月見酒", damage: SCORE_TABLE.TSUKIMIZAKE };
        else if(isSameMonth) res={...res,name: "三つ揃い",damage: SCORE_TABLE.MITSU_ZOROI,bonus: 0};
        else if(taneCount==3||tanCount==3) res={...res,name: "三丁",damage: SCORE_TABLE.SANCHO};
        else if(taneCount>= 2||tanCount>= 2) res={...res,name: "繋ぎ",damage: SCORE_TABLE.TSUNAGI};
        else if(kasuCount==3) res={...res,name: "カス",damage: SCORE_TABLE.KASU};

        return res;
    }

    static hasInoShikaCho(c){return [10,7,6].every(m=>c.some(x=>x.month==m&&x.type=='tane'));}
    static hasOmoteSugawara(c){return c.some(x=>x.month==1&&x.type=='light')&&c.some(x=>x.month==2&&x.type=='tane')&&c.some(x=>x.month==3&&x.type=='light');}
    static isTanzakuSet(m){ return [1,2,3].every(x=>m.includes(x))||[6, 9, 10].every(x=>m.includes(x));}
    static hasMatch(c,m1,t1,m2,t2){ return c.some(x=>x.month==m1&&x.type==t1)&&c.some(x=>x.month==m2&&x.type==t2);}
}

//ゲーム状態管理
const rooms=new Map();

function createDeck(){
    let d=[];
    for(let m=1;m<=12;m++)
        for(let i 0 i<4;i++)
            d.push({id: `${m}-${i}`,month: m,type: CARD_TEMPLATES[m-1][i]});
    return shuffle(d);
}

function shuffle(a){
    for(let i=a.length-1;i>0;i--){
        const j=Math.floor(Math.random()*(i+1));
        [a[i],a[j]]=[a[j],a[i]];
    }
    return a;
}

io.on('connection',(socket)=>{
    socket.on('join',(data)=>{
        try {
            const roomId=data.roomId||"default";
            if (!rooms.has(roomId)){
                rooms.set(roomId,{
                    id: roomId,deck: createDeck(),discardPile: [],
                    players:{ p1: { id: null,hp: 20,hand: [] },p2: { id: null,hp: 20, hand: [] }},
                    submissions: {},fieldMonth: Math.floor(Math.random()*12)+1,status: 'waiting'
                });
            }
            const room=rooms.get(roomId);
            let role=room.players.p1.id===null?'p1' : (room.players.p2.id === null?'p2' : null);

            if(!role) return socket.emit('error_msg','Room Full');

            room.players[role].id=socket.id;
            socket.join(roomId);
            socket.emit('role_assigned',role);

            if(room.players.p1.id&&room.players.p2.id&&room.status==='waiting'){
                room.status='playing';
                room.players.p1.hand=room.deck.splice(0,5);
                room.players.p2.hand=room.deck.splice(0,5);
                io.to(room.players.p1.id).emit('game_start',{fieldMonth: room.fieldMonth,hand: room.players.p1.hand,deckCount: room.deck.length});
                io.to(room.players.p2.id).emit('game_start',{fieldMonth: room.fieldMonth,hand: room.players.p2.hand,deckCount: room.deck.length});
            }
        } catch (e){console.error("Join Error:", e);}
    });

    socket.on('submit_attack',(cards)=>{
        try{
            const room=getRoomBySocket(socket.id);
            if(!room||room.status!=='playing')return;
           
            const role=room.players.p1.id===socket.id?'p1' : 'p2';
           //手札にそのカードがあるか
            const hasCards=cards.every(c=>room.players[role].hand.some(h=>h.id===c.id));
            if(!hasCards) return socket.emit('error_msg', 'Invalid Cards');

            room.submissions[socket.id]=cards;
            if(Object.keys(room.submissions).length===2)processTurn(room);
            else socket.to(room.id).emit('wait_opponent');
        } catch (e){console.error("Attack Error:",e);}
    });

    socket.on('redraw',(ids)=>{
        try {
            const room=getRoomBySocket(socket.id);
            if(!room)return;
            const p=room.players[room.players.p1.id===socket.id?'p1' : 'p2'];
            if (!ids.every(id=>p.hand.some(h=>h.id===id)))return;

            const discarded=p.hand.filter(c=>ids.includes(c.id));
            p.hand=p.hand.filter(c=>!ids.includes(c.id));
            room.discardPile.push(...discarded);

            checkAndReplenish(room);
            const newCards=room.deck.splice(0,ids.length);
            p.hand.push(...newCards);
            socket.emit('redraw_done',{hand: p.hand,deckCount: room.deck.length});
        } catch (e){ console.error("Redraw Error:", e); }
    });

    socket.on('disconnect',()=>{
        const room=getRoomBySocket(socket.id);
        if(room){
            if(room.players.p1.id===socket.id)room.players.p1.id=null;
            else room.players.p2.id=null;
            if(!room.players.p1.id&&!room.players.p2.id)rooms.delete(room.id);
            else room.status='waiting';
        }
    });
});

function getRoomBySocket(sid){
    for (let r of rooms.values()) if(r.players.p1.id===sid||r.players.p2.id===sid)return r;
    return null;
}

function checkAndReplenish(room){
    if(room.deck.length<10&&room.discardPile.length>0){
        room.deck.push(...shuffle(room.discardPile));
        room.discardPile=[];
    }
}

function processTurn(room){
    const p1=room.players.p1;
    const p2=room.players.p2;
    const res1=GameEngine.judge(room.submissions[p1.id],room.fieldMonth);
    const res2=GameEngine.judge(room.submissions[p2.id],room.fieldMonth);

    const dmg1=res2.isSpecial?res2.damage : Math.max(0,(res2.damage+res2.bonus)-(res1.damage+res1.bonus));
    const dmg2=res1.isSpecial?res1.damage : Math.max(0,(res1.damage+res1.bonus)-(res2.damage+res2.bonus));

    p1.hp-=dmg1;
    p2.hp-=dmg2;
    room.discardPile.push(...room.submissions[p1.id],...room.submissions[p2.id]);
   
    p1.hand=p1.hand.filter(c=>!room.submissions[p1.id].some(s=>s.id===c.id));
    p2.hand=p2.hand.filter(c=>!room.submissions[p2.id].some(s=>s.id===c.id));

    checkAndReplenish(room);
    const n1=room.deck.splice(0,3);
    const n2=room.deck.splice(0,3);
    p1.hand.push(...n1);
    p2.hand.push(...n2);

    const common={subs: room.submissions,res: { p1: res1, p2: res2 },hp: {p1: p1.hp,p2: p2.hp},dc: room.deck.length};
    io.to(p1.id).emit('turn_result',{ ...common,hand: p1.hand});
    io.to(p2.id).emit('turn_result',{ ...common,hand: p2.hand});

    room.submissions = {};
}

http.listen(3000,()=>console.log('Enterprise Battle Server on 3000'));
