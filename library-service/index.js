const express = require('express');
const { Pool, types } = require('pg'); types.setTypeParser(1082, value => value);
const app = express(); app.use(express.json());
const db = new Pool({ connectionString: process.env.DATABASE_URL });
app.get('/manage/health', (_req,res) => res.sendStatus(200));
app.get('/internal/libraries', async (req,res,next) => { try {
 const page=Math.max(1,Number(req.query.page)||1), size=Math.min(100,Math.max(1,Number(req.query.size)||10));
 const [items,total]=await Promise.all([db.query('SELECT library_uid AS "libraryUid",name,address,city FROM library WHERE city=$1 ORDER BY id LIMIT $2 OFFSET $3',[req.query.city,size,(page-1)*size]),db.query('SELECT count(*) FROM library WHERE city=$1',[req.query.city])]);
 res.json({page,pageSize:items.rowCount,totalElements:Number(total.rows[0].count),items:items.rows});
 } catch(e){next(e)} });
app.get('/internal/libraries/:uid/books', async(req,res,next)=>{try{
 const page=Math.max(1,Number(req.query.page)||1), size=Math.min(100,Math.max(1,Number(req.query.size)||25));
 const filter=req.query.showAll==='true'?'':'AND lb.available_count > 0';
 const sql=`SELECT b.book_uid AS "bookUid",b.name,b.author,b.genre,b.condition,lb.available_count AS "availableCount" FROM library_books lb JOIN library l ON l.id=lb.library_id JOIN books b ON b.id=lb.book_id WHERE l.library_uid=$1 ${filter} ORDER BY b.id`;
 const [items,total]=await Promise.all([db.query(sql+' LIMIT $2 OFFSET $3',[req.params.uid,size,(page-1)*size]),db.query(`SELECT count(*) FROM library_books lb JOIN library l ON l.id=lb.library_id JOIN books b ON b.id=lb.book_id WHERE l.library_uid=$1 ${filter}`,[req.params.uid])]);
 res.json({page,pageSize:items.rowCount,totalElements:Number(total.rows[0].count),items:items.rows});
 }catch(e){next(e)}});
app.get('/internal/books/:bookUid/libraries/:libraryUid',async(req,res,next)=>{try{const r=await db.query('SELECT b.book_uid AS "bookUid",b.name,b.author,b.genre,b.condition,l.library_uid AS "libraryUid",l.name AS "libraryName",l.city,l.address,lb.available_count AS "availableCount" FROM library_books lb JOIN books b ON b.id=lb.book_id JOIN library l ON l.id=lb.library_id WHERE b.book_uid=$1 AND l.library_uid=$2',[req.params.bookUid,req.params.libraryUid]); if(!r.rowCount)return res.status(404).json({message:'Book or library not found'});res.json(r.rows[0])}catch(e){next(e)}});
app.post('/internal/books/:bookUid/libraries/:libraryUid/checkout',async(req,res,next)=>{const c=await db.connect();try{await c.query('BEGIN');const r=await c.query('UPDATE library_books lb SET available_count=available_count-1 FROM books b,library l WHERE lb.book_id=b.id AND lb.library_id=l.id AND b.book_uid=$1 AND l.library_uid=$2 AND lb.available_count>0 RETURNING lb.available_count',[req.params.bookUid,req.params.libraryUid]);if(!r.rowCount){await c.query('ROLLBACK');return res.status(409).json({message:'Book is unavailable'})}await c.query('COMMIT');res.json({availableCount:r.rows[0].available_count})}catch(e){await c.query('ROLLBACK');next(e)}finally{c.release()}});
app.post('/internal/books/:bookUid/libraries/:libraryUid/return',async(req,res,next)=>{try{const r=await db.query('UPDATE library_books lb SET available_count=available_count+1 FROM books b,library l WHERE lb.book_id=b.id AND lb.library_id=l.id AND b.book_uid=$1 AND l.library_uid=$2 RETURNING lb.available_count',[req.params.bookUid,req.params.libraryUid]);if(!r.rowCount)return res.status(404).json({message:'Book or library not found'});res.json({availableCount:r.rows[0].available_count})}catch(e){next(e)}});
app.use((e,_req,res,_next)=>{console.error(e);res.status(500).json({message:'Internal server error'})});
app.listen(process.env.PORT||8060,'0.0.0.0');
