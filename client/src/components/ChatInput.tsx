import { useState, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import TextareaAutosize from 'react-textarea-autosize';
import { Bold, Italic, Strikethrough, Code, Quote, List, ListOrdered, Link2, SmilePlus, Sparkles } from 'lucide-react';
import EmojiPicker, { Theme, EmojiStyle } from 'emoji-picker-react';
import { useChatStore } from '../store/chatStore';

export function ChatInput() {
  const [text, setText]     = useState('');
  const [secure, setSecure] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [linkModal, setLinkModal] = useState({ visible: false, text: '', url: '' });
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ x: number; y: number } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [showAiMenu, setShowAiMenu] = useState(false);
  const [aiTranslateLang, setAiTranslateLang] = useState('es');
  const [captionFile, setCaptionFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const aiButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);

  // Helper: get the actual <textarea> managed by react-simple-code-editor
  const getTextarea = () => document.querySelector<HTMLTextAreaElement>('.chat-editor-textarea');

  // ── Store selectors ───────────────────────────────────────────────────────
  const status      = useChatStore((s) => s.status);
  const activeRoom  = useChatStore((s) => s.activeRoomJid);
  const activeChat  = useChatStore((s) => s.activeChat);
  const activeReply = useChatStore((s) => s.activeReply);
  const setReplyTarget = useChatStore((s) => s.setReplyTarget);
  const joinedRooms = useChatStore((s) => s.joinedRooms);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const markAsRead  = useChatStore((s) => s.markAsRead); // Fix 4
  const jwt         = useChatStore((s) => s.jwt);
  const addToast    = useChatStore((s) => s.addToast);

  // ── Send gate ─────────────────────────────────────────────────────────────
  // Must be XMPP-online AND have received the XEP-0045 join confirmation (if MUC).
  const isConnected = status === 'online';
  const isDm        = activeChat?.type === 'dm';
  const isJoined    = isDm ? true : !!joinedRooms[activeRoom];
  const canSend     = isConnected && isJoined;

  const displayName = activeChat?.name ?? activeRoom.split('@')[0];

  // ── Placeholder logic ─────────────────────────────────────────────────────
  const placeholder = !isConnected
    ? 'Connecting to XMPP…'
    : !isJoined
    ? `Joining #${displayName}…`
    : secure
    ? `🔥 Secure message to ${isDm ? '@' : '#'}${displayName}…`
    : `Message ${isDm ? '@' : '#'}${displayName}`;

  const MSG_MAX_BYTES = 3072; // req 2.5.2: 3KB max message size

  // ── Send ─────────────────────────────────────────────────────────────────
  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || !canSend) return;

    // req 2.5.2: enforce 3KB message size limit
    const byteLen = new TextEncoder().encode(trimmed).length;
    if (byteLen > MSG_MAX_BYTES) {
      addToast(`Message too long (${byteLen} bytes). Maximum is 3KB.`, 'error');
      return;
    }

    sendMessage(activeRoom, trimmed, secure);
    markAsRead(activeRoom); // Dissolve unread divider/badges since user just sent a message
    setText('');
    getTextarea()?.focus();
  };

  // ── AI Transform ─────────────────────────────────────────────────────────
  const runAiTransform = async (action: 'improve' | 'spelling' | 'translate') => {
    const trimmed = text.trim();
    if (!trimmed) { addToast('Type something first before using AI.', 'error'); return; }
    setShowAiMenu(false);
    setAiLoading(true);
    try {
      const res = await fetch('/api/ai/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ action, text: trimmed, targetLang: aiTranslateLang }),
      });
      if (!res.ok) throw new Error('AI request failed');
      const data = await res.json();
      setText(data.result);
      addToast(`✨ ${action === 'improve' ? 'Writing improved' : action === 'spelling' ? 'Spelling fixed' : 'Translated'} successfully!`, 'success');
      getTextarea()?.focus();
    } catch (e: any) {
      addToast(e.message || 'AI request failed', 'error');
    } finally {
      setAiLoading(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === 'Enter' && e.shiftKey) {
      const start = e.currentTarget.selectionStart;
      const textUpToCursor = text.slice(0, start);
      const lines = textUpToCursor.split('\n');
      const currentLine = lines[lines.length - 1];

      const bulletMatch = currentLine.match(/^(\s*)-\s$/);
      const numMatch = currentLine.match(/^(\s*)(\d+)\.\s$/);
      
      // If empty bullet/number, remove it instead of adding next
      if (bulletMatch || numMatch) {
        e.preventDefault();
        const removeLen = currentLine.length;
        setText(text.slice(0, start - removeLen) + text.slice(e.currentTarget.selectionEnd));
        setTimeout(() => {
          getTextarea()?.focus();
          getTextarea()?.setSelectionRange(start - removeLen, start - removeLen);
        }, 0);
        return;
      }

      const bulletActive = currentLine.match(/^(\s*)-\s/);
      const numActive = currentLine.match(/^(\s*)(\d+)\.\s/);

      if (bulletActive || numActive) {
        e.preventDefault();
        const padding = bulletActive ? bulletActive[1] : numActive ? numActive[1] : '';
        let prefix = `\n${padding}- `;
        if (numActive) {
          prefix = `\n${padding}${parseInt(numActive[2], 10) + 1}. `;
        }
        insertFormat(prefix, '', false);
      }
    }
  };

  const insertFormat = (prefix: string, suffix: string = '', isLineStart: boolean = false) => {
    const ta = getTextarea();
    const start = ta?.selectionStart ?? text.length;
    const end = ta?.selectionEnd ?? text.length;
    const current = text;

    let actualPrefix = prefix;
    if (isLineStart && start > 0 && current[start - 1] !== '\n') {
      actualPrefix = '\n' + prefix;
    }

    const selected = current.slice(start, end) || (suffix ? 'text' : '');
    const newText = current.slice(0, start) + actualPrefix + selected + suffix + current.slice(end);
    setText(newText);
    setTimeout(() => {
      getTextarea()?.focus();
      getTextarea()?.setSelectionRange(start + actualPrefix.length, start + actualPrefix.length + selected.length);
    }, 0);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // Delegate to the caption modal — it validates, shows a caption prompt, then calls handleUploadWithCaption
    const file = e.target.files?.[0];
    if (!file) return;
    setCaptionFile(file);
    setCaption('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Paste-to-upload (req 2.6.2) ────────────────────────────────────────────
  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return; // plain text paste — let default handle it
    e.preventDefault();
    const file = files[0];
    setCaptionFile(file);
    setCaption('');
  };

  // ── Shared upload executor (used by button + paste + caption modal) ──────
  const handleUploadWithCaption = async (file: File, captionText: string) => {
    const ALLOWED_MIME_TYPES = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'application/pdf', 'text/plain', 'text/csv'
    ];
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      addToast('File type not allowed. Please upload images, PDFs, or text files.', 'error');
      return;
    }
    const isImage = file.type.startsWith('image/');
    const maxSize = isImage ? 3 * 1024 * 1024 : 20 * 1024 * 1024;
    if (file.size > maxSize) {
      addToast(`${isImage ? 'Image' : 'File'} exceeds ${isImage ? '3MB' : '20MB'} limit.`, 'error');
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('roomId', activeRoom);
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      const payload = JSON.stringify({
        type: 'file_ref',
        fileId: data.fileId,
        fileName: data.originalName,
        mimeType: data.mimeType,
        content: captionText ? captionText : `Attached: ${data.originalName}`,
        caption: captionText || undefined,
      });
      sendMessage(activeRoom, payload, false);
    } catch (err) {
      addToast('Upload failed. Please try again.', 'error');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div 
      className="group"
      style={{
      position: 'relative',
      padding: '10px 16px 14px',
      background: '#111318',
      borderTop: '1px solid rgba(255,255,255,0.06)',
      flexShrink: 0,
      width: '100%',
      boxSizing: 'border-box',
      overflowX: 'hidden',
    }}>
      {/* activeReply Layout Block */}
      {activeReply && (
        <div className="flex items-center justify-between bg-gray-800/80 px-3 py-2 rounded-t-lg border border-gray-700/50 mb-1 shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 overflow-hidden mr-3">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
              <polyline points="9 17 4 12 9 7"></polyline>
              <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
            </svg>
            <span className="text-[11px] font-bold text-indigo-400 whitespace-nowrap">Replying to {activeReply.senderName}:</span>
            <span className="text-[11px] text-gray-300 truncate opacity-90 italic max-w-[400px]">"{activeReply.body}"</span>
          </div>
          <button 
            onClick={() => setReplyTarget(null)} 
            className="text-gray-500 hover:text-white transition-colors bg-gray-900/50 hover:bg-red-500/20 rounded p-0.5"
            title="Cancel Reply"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      )}

      {/* Formatting Toolbar */}
      <div className="flex items-center gap-1 px-0.5 overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] opacity-0 max-h-0 pointer-events-none group-focus-within:opacity-100 group-focus-within:max-h-10 group-focus-within:mb-1.5 group-focus-within:pointer-events-auto" style={{ zIndex: 10 }}>
        <button onClick={() => insertFormat('**', '**')} title="Bold" className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
          <Bold size={15} strokeWidth={2.5} />
        </button>
        <button onClick={() => insertFormat('_', '_')} title="Italic" className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
          <Italic size={15} strokeWidth={2.5} />
        </button>
        <button onClick={() => insertFormat('~~', '~~')} title="Strikethrough" className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
          <Strikethrough size={14} strokeWidth={2.5} />
        </button>
        <button onClick={() => insertFormat('\n```\n', '\n```\n')} title="Code Block" className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
          <Code size={15} strokeWidth={2.5} />
        </button>

        <div className="w-[1px] h-4 bg-gray-700/50 mx-1"></div>

        <button onClick={() => insertFormat('> ', '', true)} title="Blockquote" className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
          <Quote size={14} strokeWidth={2.5} />
        </button>
        <button onClick={() => insertFormat('- ', '', true)} title="Bullet List" className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
          <List size={15} strokeWidth={2.5} />
        </button>
        <button onClick={() => insertFormat('1. ', '', true)} title="Numbered List" className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
          <ListOrdered size={15} strokeWidth={2.5} />
        </button>

        <div className="w-[1px] h-4 bg-gray-700/50 mx-1"></div>

        <button onClick={() => {
          const ta = getTextarea();
          const start = ta?.selectionStart || 0;
          const end = ta?.selectionEnd || 0;
          const selected = text.slice(start, end);
          setLinkModal({ visible: true, text: selected, url: '' });
        }} title="Link" className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-800 transition-colors">
          <Link2 size={15} strokeWidth={2.5} />
        </button>

        <div className="w-[1px] h-4 bg-gray-700/50 mx-1"></div>

        {/* Emoji toggle inside Toolbar */}
        <div className="relative" ref={emojiRef}>
          <button
            ref={emojiButtonRef}
            onClick={() => {
              if (showEmoji) {
                setShowEmoji(false);
                setEmojiPickerPos(null);
              } else {
                const rect = emojiButtonRef.current?.getBoundingClientRect();
                if (rect) setEmojiPickerPos({ x: rect.left, y: rect.top });
                setShowEmoji(true);
              }
            }}
            disabled={!canSend}
            title="Add Emoji"
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ml-1 ${showEmoji ? 'bg-indigo-500/20 text-indigo-400' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
          >
             <SmilePlus size={16} strokeWidth={2.5} />
          </button>
          {showEmoji && emojiPickerPos && createPortal(
            <div
              style={{
                position: 'fixed',
                bottom: window.innerHeight - emojiPickerPos.y + 8,
                left: emojiPickerPos.x,
                zIndex: 9999,
                width: 300,
              }}
              className="shadow-2xl">
              <EmojiPicker 
                theme={Theme.DARK}
                emojiStyle={EmojiStyle.NATIVE}
                onEmojiClick={(emoji) => {
                  insertFormat(emoji.emoji);
                  setShowEmoji(false);
                  setEmojiPickerPos(null);
                }} 
              />
            </div>,
            document.body
          )}
        </div>
      </div>

      {/* ── AI Sparkle button (appended to toolbar, outside of hidden div for visibility) */}
      <div className="flex items-center px-0.5 overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] opacity-0 max-h-0 pointer-events-none group-focus-within:opacity-100 group-focus-within:max-h-10 group-focus-within:pointer-events-auto" style={{ zIndex: 11 }}>
        <div className="w-[1px] h-4 bg-gray-700/50 mx-1" />
        <div className="relative">
          <button
            ref={aiButtonRef}
            onClick={() => setShowAiMenu(v => !v)}
            disabled={!canSend || aiLoading}
            title="AI Writing Assistant"
            className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${showAiMenu ? 'bg-indigo-500/20 text-indigo-400' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
          >
            {aiLoading ? (
              <div style={{ width: 13, height: 13, border: '2px solid rgba(99,102,241,0.3)', borderTopColor: '#818cf8', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            ) : (
              <Sparkles size={15} strokeWidth={2.5} />
            )}
          </button>

          {showAiMenu && createPortal(
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 9990 }} onClick={() => setShowAiMenu(false)} />
              <div style={{
                position: 'fixed',
                bottom: (() => { const r = aiButtonRef.current?.getBoundingClientRect(); return r ? window.innerHeight - r.top + 8 : 120; })(),
                left: (() => { const r = aiButtonRef.current?.getBoundingClientRect(); return r ? Math.max(8, r.left - 8) : 100; })(),
                zIndex: 9999,
                background: '#1a1e2a',
                border: '1px solid rgba(99,102,241,0.3)',
                borderRadius: 12, padding: '10px', width: 220,
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#6366f1', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 2px' }}>
                  ✨ AI Writing Assistant
                </div>
                {([
                  { action: 'improve' as const, icon: '✨', label: 'Improve Writing', desc: 'Polish tone & grammar' },
                  { action: 'spelling' as const, icon: '🔤', label: 'Fix Spelling', desc: 'Auto-correct typos' },
                ] as const).map(({ action, icon, label, desc }) => (
                  <button key={action} onClick={() => runAiTransform(action)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.12)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ fontSize: 16 }}>{icon}</span>
                    <div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#e2e8f0' }}>{label}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{desc}</div>
                    </div>
                  </button>
                ))}
                {/* Translate row */}
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 4, paddingTop: 10, padding: '10px 10px 8px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 16, marginTop: 14 }}>🌍</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: '#e2e8f0', marginBottom: 5 }}>Translate to</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select value={aiTranslateLang} onChange={e => setAiTranslateLang(e.target.value)} onClick={e => e.stopPropagation()}
                        style={{ flex: 1, background: '#0f172a', border: '1px solid rgba(99,102,241,0.3)', color: '#cbd5e1', borderRadius: 6, padding: '3px 6px', fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
                      >
                        <option value="es">🇪🇸 Spanish</option>
                        <option value="fr">🇫🇷 French</option>
                        <option value="de">🇩🇪 German</option>
                        <option value="uk">🇺🇦 Ukrainian</option>
                        <option value="ru">🇷🇺 Russian</option>
                        <option value="zh">🇨🇳 Chinese</option>
                        <option value="ja">🇯🇵 Japanese</option>
                        <option value="ar">🇸🇦 Arabic</option>
                      </select>
                      <button onClick={() => runAiTransform('translate')}
                        style={{ padding: '3px 10px', fontSize: 11.5, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#6366f1,#818cf8)', color: '#fff', fontFamily: 'inherit' }}>
                        Go
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>,
            document.body
          )}
        </div>
      </div>

      {/* Input row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        background: '#1a1e2a',
        border: `1.5px solid ${secure ? 'rgba(99,102,241,0.5)' : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 10, padding: '8px 10px',
        boxShadow: secure ? '0 0 0 3px rgba(99,102,241,0.08), 0 0 20px rgba(99,102,241,0.08)' : 'none',
        transition: 'border-color 0.2s, box-shadow 0.2s',
      }}>
        {/* File attachment */}
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!canSend || isUploading}
          title="Attach File"
          style={{
            width: 30, height: 30, borderRadius: 7, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', cursor: canSend && !isUploading ? 'pointer' : 'not-allowed', fontSize: 15,
            background: 'transparent', color: '#64748b',
            transition: 'all 0.2s',
            opacity: canSend && !isUploading ? 1 : 0.5
          }}
        >
          {isUploading ? (
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.2)', borderTopColor: '#fff',
              animation: 'spin 0.8s linear infinite'
            }} />
          ) : (
            '📎'
          )}
        </button>



        {/* Secure mode toggle */}
        <button
          onClick={() => setSecure((v) => !v)}
          title={secure ? 'Secure Mode ON — click to disable' : 'Click to enable Secure Mode'}
          style={{
            width: 30, height: 30, borderRadius: 7, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', cursor: 'pointer', fontSize: 15,
            fontFamily: 'inherit',
            background: secure ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
            color: secure ? '#818cf8' : '#64748b',
            boxShadow: secure ? '0 0 12px rgba(99,102,241,0.3)' : 'none',
            transition: 'all 0.2s',
          }}
        >
          🔒
        </button>

        {/* Text input */}
        <TextareaAutosize
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown as any}
          onPaste={handlePaste}
          disabled={!canSend}
          placeholder={placeholder}
          minRows={1}
          maxRows={6}
          className="chat-editor-textarea"
          onFocus={() => markAsRead(activeRoom)}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontSize: 14, color: '#e2e8f0', resize: 'none', overflowY: 'auto',
            padding: 0, fontFamily: 'inherit',
            opacity: isConnected && !isJoined ? 0.5 : 1,
            transition: 'opacity 0.3s',
          }}
        />

        {/* req 2.5.2: Character/byte counter near the limit */}
        {text.length > 2500 && (
          <span style={{
            fontSize: 10, fontWeight: 600, flexShrink: 0,
            color: new TextEncoder().encode(text).length > MSG_MAX_BYTES ? '#f87171' : '#94a3b8',
          }}>
            {new TextEncoder().encode(text).length}/{MSG_MAX_BYTES}B
          </span>
        )}

        {/* Send button */}
        <button
          onClick={send}
          disabled={!canSend || !text.trim()}
          style={{
            height: 30, padding: '0 14px', borderRadius: 7,
            border: 'none',
            cursor: canSend && text.trim() ? 'pointer' : 'not-allowed',
            fontSize: 13, fontWeight: 600, color: '#fff', fontFamily: 'inherit',
            background: secure
              ? 'linear-gradient(135deg,#6366f1,#9f7aea)'
              : 'linear-gradient(135deg,#3b82f6,#6366f1)',
            opacity: canSend && text.trim() ? 1 : 0.45,
            transition: 'all 0.2s',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          Send
        </button>
      </div>

      {/* Status hint */}
      <div style={{
        marginTop: 5, padding: '0 6px',
        fontSize: 11,
        color: secure ? '#818cf8' : '#475569',
        display: 'flex', alignItems: 'center', gap: 5,
        transition: 'color 0.2s',
      }}>
        {!isConnected ? (
          <>⏳ Connecting to XMPP server…</>
        ) : !isJoined ? (
          <>⏳ Joining <strong>#{displayName}</strong>…</>
        ) : secure ? (
          <>🔥 <strong>SECURE MODE ON</strong> — message will auto-destruct after reading</>
        ) : (
          <>🔒 Secure Mode OFF — click the lock to send ephemeral messages</>
        )}
      </div>

      {/* Caption Modal (attach + paste preview) */}
      {captionFile && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
             onClick={() => setCaptionFile(null)}>
          <div className="bg-[#1a1e2a] border border-white/10 rounded-2xl p-6 w-80 shadow-2xl"
               onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-200 mb-1">
              {captionFile.type.startsWith('image/') ? '🖼 Send Image' : '📎 Send File'}
            </h3>
            <p className="text-xs text-slate-500 mb-4 truncate">{captionFile.name}</p>
            <input
              autoFocus
              type="text"
              placeholder="Add a caption (optional)"
              className="bg-[#0f172a] border border-white/10 text-slate-200 text-sm rounded-lg px-3 py-2 w-full outline-none focus:border-indigo-500 transition-colors mb-4"
              value={caption}
              onChange={e => setCaption(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  handleUploadWithCaption(captionFile!, caption);
                  setCaptionFile(null);
                }
                if (e.key === 'Escape') setCaptionFile(null);
              }}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setCaptionFile(null)}
                className="px-4 py-2 text-xs text-slate-400 hover:text-white transition-colors">
                Cancel
              </button>
              <button
                onClick={() => { handleUploadWithCaption(captionFile!, caption); setCaptionFile(null); }}
                disabled={isUploading}
                className="px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors font-semibold disabled:opacity-50">
                {isUploading ? 'Uploading…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link Modal Portal */}
      {linkModal.visible && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50" onClick={() => setLinkModal({ visible: false, text: '', url: '' })}>
          <div className="bg-gray-800 border border-gray-700/80 shadow-2xl rounded-lg p-4 w-72 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-200">Insert Link</h3>
            <div className="flex flex-col gap-2">
              <input 
                autoFocus
                type="text" 
                placeholder="Display text (optional)" 
                className="bg-gray-900 border border-gray-700 text-sm rounded p-2 text-white outline-none focus:border-indigo-500"
                value={linkModal.text}
                onChange={e => setLinkModal(m => ({ ...m, text: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Escape') setLinkModal({ visible: false, text: '', url: '' }); }}
              />
              <input 
                type="text" 
                placeholder="URL (e.g. https://google.com)" 
                className="bg-gray-900 border border-gray-700 text-sm rounded p-2 text-white outline-none focus:border-indigo-500"
                value={linkModal.url}
                onChange={e => setLinkModal(m => ({ ...m, url: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setLinkModal({ visible: false, text: '', url: '' });
                  if (e.key === 'Enter') {
                    if (linkModal.url) {
                      insertFormat(`[${linkModal.text || 'link'}](${linkModal.url})`);
                      setLinkModal({ visible: false, text: '', url: '' });
                    }
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2 mt-1">
              <button onClick={() => setLinkModal({ visible: false, text: '', url: '' })} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={() => {
                if (linkModal.url) {
                  insertFormat(`[${linkModal.text || 'link'}](${linkModal.url})`);
                  setLinkModal({ visible: false, text: '', url: '' });
                }
              }} className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors font-medium">Insert</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
