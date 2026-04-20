import React, { useRef } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useChatStore } from '../store/chatStore';
import { useAuthStore } from '../store/authStore';
import { MessageBubble } from './MessageBubble';
import type { Message } from '../types/chat';

// Stable empty array — MUST be module-level. Inline `?? []` creates a new
// reference on every render, which breaks Zustand's Object.is comparison
// and causes an infinite update loop when there are no messages.
const EMPTY_MESSAGES: Message[] = [];

// ---------------------------------------------------------------------------
// Custom Scroller — overrides react-virtuoso's internal scroller to HARD-BLOCK
// horizontal scrolling. Without this, virtuoso's own overflow:auto creates a
// horizontal scrollbar even when the center pane has overflow:hidden.
// ---------------------------------------------------------------------------
const NoHScroller = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithRef<'div'>
>((props, ref) => (
  <div
    {...props}
    ref={ref}
    style={{
      ...props.style,
      overflowX: 'hidden',   // ← the one property virtuoso won't set itself
    }}
  />
));
NoHScroller.displayName = 'NoHScroller';

// ---------------------------------------------------------------------------
// "New Messages" divider
// ---------------------------------------------------------------------------
function NewMessagesDivider({ count }: { count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0 8px' }}>
      <div style={{ flex: 1, height: 1, background: 'rgba(239,68,68,0.35)' }} />
      <span style={{
        fontSize: 11, fontWeight: 600, color: '#f87171',
        background: 'rgba(239,68,68,0.1)',
        border: '1px solid rgba(239,68,68,0.25)',
        borderRadius: 20, padding: '2px 12px', whiteSpace: 'nowrap',
      }}>
        {count} new message{count !== 1 ? 's' : ''}
      </span>
      <div style={{ flex: 1, height: 1, background: 'rgba(239,68,68,0.35)' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date separator
// ---------------------------------------------------------------------------
function DateSeparator({ date }: { date: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 4px 8px' }}>
      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
      <span style={{ fontSize: 11, color: '#475569', fontWeight: 500, whiteSpace: 'nowrap' }}>{date}</span>
      <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.07)' }} />
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// MessageList
// ---------------------------------------------------------------------------
export function MessageList() {
  const activeRoomJid = useChatStore((s) => s.activeRoomJid);
  // IMPORTANT: use EMPTY_MESSAGES (stable ref) — never `?? []` inline.
  // An inline `?? []` always returns a new array object when the key is
  // missing, which breaks Zustand's Object.is comparison → infinite loop.
  const messages      = useChatStore((s) => s.messages[s.activeRoomJid] ?? EMPTY_MESSAGES);
  const lastReadAt    = useChatStore((s) => s.lastReadAts[s.activeRoomJid] ?? null);
  const myNick        = useChatStore((s) => s.myNick);
  const user          = useAuthStore((s) => s.user);
  const virtuosoRef   = useRef<VirtuosoHandle>(null);

  const markAsRead    = useChatStore((s) => s.markAsRead);

  const currentNick = myNick ?? user?.username ?? '';

  const dynamicUnreadIdx = lastReadAt
    ? messages.findIndex((m) => m.timestamp > lastReadAt)
    : messages.length > 0 ? 0 : -1;

  // Synchronous latch for initial view indexing
  const [frozenRoom, setFrozenRoom] = React.useState<string>('');
  const [frozenUnreadIdx, setFrozenUnreadIdx] = React.useState<number>(-1);
  const [frozenUnreadCount, setFrozenUnreadCount] = React.useState<number>(0);
  const [userHasScrolled, setUserHasScrolled] = React.useState<boolean>(false);

  // Perform this synchronously during render so that when Virtuoso mounts,
  // our local copy of 'unreadIdx' is locked in perfectly before Virtuoso's
  // 'atBottomStateChange' instantly clears the global markAsRead.
  if (activeRoomJid !== frozenRoom && messages.length > 0) {
    const freshUnreadIdx = lastReadAt
      ? messages.findIndex((m) => m.timestamp > lastReadAt)
      : 0; // If no lastReadAt exists, entire room is unread -> index 0

    setFrozenUnreadIdx(freshUnreadIdx);
    setFrozenUnreadCount(freshUnreadIdx >= 0 ? messages.length - freshUnreadIdx : 0);
    setFrozenRoom(activeRoomJid);
    setUserHasScrolled(false);
  }

  const lastMsg = messages[messages.length - 1];
  const isLastMsgOwn = lastMsg && currentNick && lastMsg.sender === currentNick;

  // If the dynamic marker natively hits -1 (because markAsRead fired when hitting the bottom),
  // dissolve the unread separator organically! ONLY if they've actively scrolled (or replied), to prevent
  // instant dissolution when clicking a room where unread messages completely fit on screen.
  if (
    dynamicUnreadIdx === -1 && 
    frozenUnreadIdx !== -1 && 
    activeRoomJid === frozenRoom && 
    (userHasScrolled || isLastMsgOwn)
  ) {
    setFrozenUnreadIdx(-1);
  }

  // Use the frozen indexes if we successfully locked them
  const renderUnreadIdx = frozenRoom === activeRoomJid ? frozenUnreadIdx : dynamicUnreadIdx;
  const renderUnreadCount = frozenRoom === activeRoomJid ? frozenUnreadCount : 0;

  const firstItemIndex = 1000000 - messages.length;

  const activeChat = useChatStore((s) => s.activeChat);
  const startReached = React.useCallback(() => {
    if (activeChat?.type === 'room') {
      useChatStore.getState().fetchRoomHistory({ id: activeChat.id, jid: activeChat.jid } as any, true);
    } else if (activeChat?.type === 'dm') {
      useChatStore.getState().fetchDmHistory({ id: activeChat.id, jid: activeChat.jid, username: activeChat.name } as any, true);
    }
  }, [activeChat]);

  return (
    <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
      <Virtuoso
        key={`${activeRoomJid}-${messages.length > 0 ? 'loaded' : 'empty'}`}
        ref={virtuosoRef}
        data={messages}
        firstItemIndex={firstItemIndex}
        startReached={startReached}
        followOutput={(isAtBottom) => isAtBottom ? 'smooth' : false}
        initialTopMostItemIndex={
          messages.length > 0 
            ? { 
                index: renderUnreadIdx >= 0 ? renderUnreadIdx + firstItemIndex : messages.length - 1 + firstItemIndex, 
                align: renderUnreadIdx >= 0 ? 'start' : 'end' 
              } 
            : 0
        }
        style={{ height: '100%' }}
        components={{ Scroller: NoHScroller }}
        isScrolling={(scrolling) => {
          if (scrolling) setUserHasScrolled(true);
        }}
        itemsRendered={(items) => {
          if (items.length === 0 || frozenRoom !== activeRoomJid) return;
          const lowestVisibleMsg = items[items.length - 1]?.data;
          if (!lowestVisibleMsg) return;
          useChatStore.getState().markAsReadUpTo(activeRoomJid, lowestVisibleMsg.timestamp);
        }}
        atBottomStateChange={(atBottom) => {
          if (atBottom && frozenRoom === activeRoomJid) markAsRead(activeRoomJid);
        }}
        itemContent={(index, msg) => {
          const normalizedIndex = index - firstItemIndex;
          const prevMsg = normalizedIndex > 0 ? messages[normalizedIndex - 1] : null;
          const isOwn      = msg.sender === currentNick;
          const showAvatar = !prevMsg || prevMsg.sender !== msg.sender;
          const showDate   = !prevMsg || formatDate(prevMsg.timestamp) !== formatDate(msg.timestamp);
          const isUnread   = renderUnreadIdx >= 0 && normalizedIndex >= renderUnreadIdx;

          return (
            <div style={{
              paddingLeft: 8,
              paddingRight: 24,
              boxSizing: 'border-box',
              minWidth: 0,
              overflowX: 'hidden',
            }}>
              {showDate && <DateSeparator date={formatDate(msg.timestamp)} />}

              {normalizedIndex === renderUnreadIdx && renderUnreadIdx >= 0 && (
                <NewMessagesDivider count={renderUnreadCount} />
              )}

              <MessageBubble
                message={msg}
                isOwn={isOwn}
                showAvatar={showAvatar}
                isUnread={isUnread}
              />
            </div>
          );
        }}
      />
    </div>
  );
}
