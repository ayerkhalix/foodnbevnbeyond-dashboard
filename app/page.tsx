'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bell, Camera, ChevronDown, ChevronLeft, ChevronRight, Hotel, Menu, MessageCircle, Moon, Paperclip, Search, Send, Sun, Utensils, X } from 'lucide-react'

type Business = { name: string; short: string; color: string; logo: string; icon: typeof Hotel; unread: number }
type Conversation = { id: number; name: string; initials: string; business: Business; preview: string; time: string; unread: number; messages: { from: 'customer' | 'staff'; text: string; time: string }[] }

const businesses: Business[] = [
  { name: 'Coco Resort El Nido', short: 'Coco Resort', color: 'coco', logo: '/logos/coco%20resto.jpg', icon: Hotel, unread: 3 },
  { name: 'The Lighthouse Seafood Restaurant', short: 'The Lighthouse', color: 'lighthouse', logo: '/logos/the%20lighthouse.jpg', icon: Utensils, unread: 5 },
  { name: 'The Moringa Tree Resort', short: 'The Moringa Tree', color: 'moringa', logo: '/logos/moringa%20tree.jpg', icon: Hotel, unread: 2 },
  { name: 'Sa Kurbada Hapag-Karaenan', short: 'Sa Kurbada', color: 'kurbada', logo: '/logos/kurbada%20sa%20hapag%20karaenan.jpg', icon: Utensils, unread: 2 },
]

const conversations: Conversation[] = [
  { id: 1, name: 'Juan Dela Cruz', initials: 'JD', business: businesses[0], preview: 'Hi! Do you have rooms available this weekend?', time: '2m ago', unread: 2, messages: [{ from: 'customer', text: 'Hi! Do you have rooms available for August 25?', time: '10:42 AM' }, { from: 'staff', text: 'Hello! Thank you for contacting Coco Resort El Nido. Yes, we currently have available rooms.', time: '10:46 AM' }, { from: 'customer', text: 'That is great. Could you send me the rates?', time: '10:48 AM' }] },
  { id: 2, name: 'Maria Santos', initials: 'MS', business: businesses[1], preview: 'Hello, what time do you close?', time: '10m ago', unread: 1, messages: [{ from: 'customer', text: 'Hello, what time do you close?', time: '10:34 AM' }, { from: 'staff', text: 'We are open daily until 10:00 PM. Our kitchen takes its last orders at 9:30 PM.', time: '10:37 AM' }] },
  { id: 3, name: 'Carlos Reyes', initials: 'CR', business: businesses[2], preview: 'Do you offer airport transfers?', time: '24m ago', unread: 0, messages: [{ from: 'customer', text: 'Do you offer airport transfers from Puerto Princesa?', time: '10:20 AM' }, { from: 'staff', text: 'Yes, we can arrange a private transfer for your stay.', time: '10:24 AM' }] },
  { id: 4, name: 'Ana Villanueva', initials: 'AV', business: businesses[3], preview: 'Can I see your menu?', time: '1h ago', unread: 0, messages: [{ from: 'customer', text: 'Can I see your menu?', time: '9:30 AM' }, { from: 'staff', text: 'Of course. I will send that right over.', time: '9:34 AM' }] },
  { id: 5, name: 'Paolo Garcia', initials: 'PG', business: businesses[0], preview: 'Is the beachfront villa pet friendly?', time: '2h ago', unread: 0, messages: [{ from: 'customer', text: 'Is the beachfront villa pet friendly?', time: '8:45 AM' }, { from: 'staff', text: 'Yes, well-behaved pets are welcome in our beachfront villas. We will share the pet guidelines with your booking details.', time: '8:49 AM' }] },
  { id: 6, name: 'Liza Mercado', initials: 'LM', business: businesses[1], preview: 'We would like to book dinner for six.', time: '3h ago', unread: 0, messages: [{ from: 'customer', text: 'We would like to book dinner for six.', time: '8:12 AM' }, { from: 'staff', text: 'We would be happy to host your group of six. Please let us know your preferred date and seating time.', time: '8:16 AM' }] },
]

function BusinessBadge({ business }: { business: Business }) { return <span className={`business-badge ${business.color}`}><img src={business.logo} alt="" /><span>{business.name}</span></span> }
function Avatar({ initials, large = false }: { initials: string; large?: boolean }) { return <div className={`avatar ${large ? 'avatar-large' : ''}`}>{initials}</div> }

function BusinessList({ selected, onSelect, onClose }: { selected: string; onSelect: (name: string) => void; onClose: () => void }) {
  return <aside className="businesses-panel"><div className="brand"><img className="brand-logo" src="/food%20n%20bev%20transparent.png" alt="Food N Bev & Beyond" /><div><strong>FOOD N BEV & BEYOND</strong><small>CORPORATION</small></div><button className="close-mobile" onClick={onClose} aria-label="Close menu"><X /></button></div><div className="businesses-title">BUSINESSES</div><button className={`business-link ${selected === 'All Messages' ? 'selected' : ''}`} onClick={() => onSelect('All Messages')}><MessageCircle /><span>All Messages</span><b>12</b></button><div className="business-list">{businesses.map((business) => { return <button key={business.name} className={`business-link ${business.color} ${selected === business.name ? 'selected' : ''}`} onClick={() => onSelect(business.name)}><span className="business-icon"><img src={business.logo} alt="" /></span><span className="business-name">{business.name}</span>{business.unread > 0 && <b>{business.unread}</b>}</button> })}</div><div className="panel-footer"><div className="profile"><Avatar initials="MS" /><span><strong>Maria Santos</strong><small>Staff member</small></span><ChevronDown /></div></div></aside>
}

function ConversationList({ selected, setSelected, businessFilter, query, setQuery }: { selected: Conversation; setSelected: (conversation: Conversation) => void; businessFilter: string; query: string; setQuery: (query: string) => void }) {
  const filtered = useMemo(() => conversations.filter((conversation) => (businessFilter === 'All Messages' || conversation.business.name === businessFilter) && `${conversation.name} ${conversation.preview}`.toLowerCase().includes(query.toLowerCase())), [businessFilter, query])
  return <section className="conversation-panel"><header className="conversation-header"><div><h1>{businessFilter === 'All Messages' ? 'All Messages' : businessFilter}</h1><p>{businessFilter === 'All Messages' ? 'Messages from all businesses' : 'Customer messages and inquiries'}</p></div><span className="message-count">{filtered.length}</span></header><div className="search-box"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search messages..." aria-label="Search messages" /></div><div className="conversation-list">{filtered.map((conversation) => <button key={conversation.id} className={`conversation-item ${selected.id === conversation.id ? 'selected' : ''}`} onClick={() => setSelected(conversation)}><Avatar initials={conversation.initials} /><span className="conversation-content"><span className="conversation-top"><strong>{conversation.name}</strong><time>{conversation.time}</time></span><BusinessBadge business={conversation.business} /><span className="preview">{conversation.preview}</span></span>{conversation.unread > 0 && <i className="unread-dot" aria-label={`${conversation.unread} unread messages`} />}</button>)}{filtered.length === 0 && <div className="empty-small">No messages found.</div>}</div></section>
}

function Chat({ conversation, onBack }: { conversation: Conversation; onBack: () => void }) {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState(conversation.messages)
  useEffect(() => { setMessages(conversation.messages) }, [conversation.id, conversation.messages])
  const send = () => { if (!message.trim()) return; setMessages([...messages, { from: 'staff', text: message.trim(), time: 'Just now' }]); setMessage('') }
  return <section className="chat-panel"><header className="chat-header"><button className="back-button" onClick={onBack}><ArrowLeft /> Back</button><div className="chat-person"><Avatar initials={conversation.initials} large /><div><h2>{conversation.name}</h2><p>Messaging through: <strong>Facebook Messenger</strong></p><BusinessBadge business={conversation.business} /></div></div><button className="more-button" aria-label="More conversation options">•••</button></header><div className="chat-body"><div className="today-label">TODAY</div>{messages.map((message, index) => <div key={`${message.time}-${index}`} className={`message-bubble-row ${message.from}`}><div className="message-bubble"><p>{message.text}</p><time>{message.time}</time></div></div>)}</div><div className="composer"><button className="attach-button" aria-label="Attach image"><Paperclip /></button><input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) send() }} placeholder="Type your message..." aria-label="Type your message" /><button className="send-button" onClick={send}><Send /><span>Send</span></button></div></section>
}

export default function Page() {
  const [businessFilter, setBusinessFilter] = useState('All Messages')
  const [selected, setSelected] = useState(conversations[0])
  const [query, setQuery] = useState('')
  const [darkMode, setDarkMode] = useState(false)
  const [themeReady, setThemeReady] = useState(false)
  const [mobileView, setMobileView] = useState<'businesses' | 'conversations' | 'chat'>('conversations')
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => { setDarkMode(localStorage.getItem('food-n-bev-theme') === 'dark'); setThemeReady(true) }, [])
  useEffect(() => { if (themeReady) localStorage.setItem('food-n-bev-theme', darkMode ? 'dark' : 'light') }, [darkMode, themeReady])
  const selectBusiness = (name: string) => { setBusinessFilter(name); const next = conversations.find((conversation) => name === 'All Messages' || conversation.business.name === name); if (next) setSelected(next); setMobileView('conversations'); setMenuOpen(false) }
  return <div className={`messaging-app ${darkMode ? 'dark' : ''}`}><button className="mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open businesses"><Menu /></button><div className={`mobile-sidebar ${menuOpen ? 'open' : ''}`}><BusinessList selected={businessFilter} onSelect={selectBusiness} onClose={() => setMenuOpen(false)} /></div><BusinessList selected={businessFilter} onSelect={selectBusiness} onClose={() => {}} /><main className="messaging-main"><header className="topbar"><div><span className="topbar-label">CENTRAL MESSAGING</span><h2>Good morning, Maria</h2><div className="inbox-status"><span />Live inbox <strong>6 active conversations</strong></div></div><div className="topbar-actions"><button className="theme-toggle" onClick={() => setDarkMode((value) => !value)} aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'} title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>{darkMode ? <Sun /> : <Moon />}</button><button className="notification-button" aria-label="Notifications"><Bell /><i>3</i></button><div className="top-profile"><Avatar initials="MS" /><span>Maria Santos</span><ChevronDown /></div></div></header><div className={`messaging-workspace view-${mobileView}`}><ConversationList selected={selected} setSelected={(conversation) => { setSelected(conversation); setMobileView('chat') }} businessFilter={businessFilter} query={query} setQuery={setQuery} /><Chat conversation={selected} onBack={() => setMobileView('conversations')} /></div></main></div>
}
