import { useState } from 'react';
import { AIPanel } from './AIPanel';
import { RoomMembersList } from './RoomMembersList';
import { ContactsPanel } from './ContactsPanel';

interface RightPanelProps {
  width: number;
}

type TabType = 'contacts' | 'members' | 'ai';

export function RightPanel({ width }: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('contacts');

  return (
    <aside style={{
      width,
      minWidth: width,
      maxWidth: width,
      background: '#111318',
      borderLeft: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      height: '100%',
    }}>
      {/* Segmented Toggle Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: 10,
        height: 52, // match ChatHeader height
      }}>
        <div style={{
          display: 'flex',
          background: 'rgba(0,0,0,0.3)',
          borderRadius: 8,
          padding: 3,
          width: '100%',
          border: '1px solid rgba(255,255,255,0.05)',
        }}>
          <button
            onClick={() => setActiveTab('contacts')}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 6,
              border: 'none', cursor: 'pointer',
              background: activeTab === 'contacts' ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: activeTab === 'contacts' ? '#fff' : '#64748b',
              fontSize: 13, fontWeight: 600,
              fontFamily: 'inherit',
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyItems: 'center', gap: 6,
              boxShadow: activeTab === 'contacts' ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
            }}
          >
            🤝 Contacts
          </button>
          <button
            onClick={() => setActiveTab('members')}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 6,
              border: 'none', cursor: 'pointer',
              background: activeTab === 'members' ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: activeTab === 'members' ? '#fff' : '#64748b',
              fontSize: 13, fontWeight: 600,
              fontFamily: 'inherit',
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              boxShadow: activeTab === 'members' ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
            }}
          >
            👥 Members
          </button>
          <button
            onClick={() => setActiveTab('ai')}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 6,
              border: 'none', cursor: 'pointer',
              background: activeTab === 'ai' ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: activeTab === 'ai' ? '#fff' : '#64748b',
              fontSize: 13, fontWeight: 600,
              fontFamily: 'inherit',
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              boxShadow: activeTab === 'ai' ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
            }}
          >
            ✨ AI Assist
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'contacts' && <ContactsPanel />}
        {activeTab === 'members' && <RoomMembersList />}
        {activeTab === 'ai' && <AIPanel width={width} headless={true} />}
      </div>
    </aside>
  );
}
