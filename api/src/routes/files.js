'use strict';
const fs = require('fs');
const path = require('path');
const util = require('util');
const { pipeline } = require('stream');
const pump = util.promisify(pipeline);
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const db = require('../db/pool');
const { authenticate } = require('../middleware/authenticate');

// Ensure uploads dir exists
if (!fs.existsSync(config.uploadsDir)) {
  fs.mkdirSync(config.uploadsDir, { recursive: true });
}

module.exports = async function (app, opts) {
  // POST /api/files/upload
  app.post('/upload', { preHandler: [authenticate] }, async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    const ALLOWED_MIME_TYPES = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'text/plain', 'text/csv'
    ];

    if (!ALLOWED_MIME_TYPES.includes(data.mimetype)) {
      return reply.code(415).send({ 
        error: 'Unsupported Media Type', 
        message: 'File type not allowed. Please upload images, PDFs, or text files.' 
      });
    }

    const fileId = uuidv4();
    const storedFileName = `${fileId}-${data.filename}`;
    const storedPath = path.join(config.uploadsDir, storedFileName);

    // Save strictly to local volume per architectural directives
    await pump(data.file, fs.createWriteStream(storedPath));

    // For simplicity, we get the active room from standard body if present
    const roomIdInput = data.fields?.roomId ? data.fields.roomId.value : null;
    let roomUuid = null;
    if (roomIdInput && roomIdInput.includes('@conference.')) {
      const { rows } = await db.query('SELECT id FROM rooms WHERE jid = $1', [roomIdInput]);
      if (rows.length > 0) roomUuid = rows[0].id;
    }
    
    // File size might not be fully known initially if streamed, so we stat
    const stats = fs.statSync(storedPath);
    
    await db.query(
      `INSERT INTO files 
       (id, uploader_id, room_id, original_name, stored_path, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        fileId,
        request.user.id,
        roomUuid,
        data.filename,
        storedFileName,
        data.mimetype,
        stats.size,
      ]
    );

    return {
      fileId,
      originalName: data.filename,
      mimeType: data.mimetype,
      sizeBytes: stats.size
    };
  });

  // GET /api/files/:id
  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params;
    
    const { rows } = await db.query('SELECT * FROM files WHERE id = $1', [id]);
    if (rows.length === 0) {
      return reply.code(404).send({ error: 'File not found' });
    }
    
    const file = rows[0];
    const fullPath = path.join(config.uploadsDir, file.stored_path);
    
    if (!fs.existsSync(fullPath)) {
      return reply.code(404).send({ error: 'File data missing on disk' });
    }
    
    // Stream response
    reply.header('Content-Disposition', `inline; filename="${file.original_name}"`);
    reply.type(file.mime_type || 'application/octet-stream');
    return fs.createReadStream(fullPath);
  });
};
