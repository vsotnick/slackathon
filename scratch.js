const pool = require('./api/src/db/pool');
pool.query(`
  SELECT "with" AS peer_jid 
  FROM prosodyarchive 
  WHERE host = 'servera.local' AND "user" = 'vsot' AND store = 'archive' 
  AND split_part("with", '@', 1) NOT IN (
    SELECT u.username 
    FROM user_blocks ub 
    JOIN users u ON u.id = ub.blocked_id 
    WHERE ub.blocker_id = '56ee52b3-9b1d-4821-9b90-246e633fdfb5'
  ) 
  GROUP BY "with"
`).then(res => { console.log(res.rows); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })
