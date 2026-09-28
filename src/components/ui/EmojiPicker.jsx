import { useState, useRef, useEffect } from 'react';
import './EmojiPicker.css';
import { SearchIcon } from './Icons';

const RECENT_KEY = 'tradehub_recent_emoji';
const RECENT_LIMIT = 24;

const EMOJI_GROUPS = [
  { name: 'Recent', icon: '🕘' },
  { name: 'Smileys', icon: '😀' },
  { name: 'Gestures', icon: '👋' },
  { name: 'People', icon: '👤' },
  { name: 'Animals', icon: '🐶' },
  { name: 'Food', icon: '🍕' },
  { name: 'Activities', icon: '⚽' },
  { name: 'Travel', icon: '✈️' },
  { name: 'Objects', icon: '💡' },
  { name: 'Symbols', icon: '❤️' },
];

const EMOJI_ITEMS = {
  Smileys: [
    '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗',
    '😚', '😙', '😋', '😛', '😜', '🤪', '😝', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶',
    '😏', '😒', '🙄', '😬', '😮💨', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮',
    '🥵', '🥶', '🥴', '😵💫', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '🫤', '😟', '🙁', '😮', '😯',
    '😲', '😳', '🥺', '🥹', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓',
    '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻',
    '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾', '🙈', '🙉', '🙊', '💋',
    '💌', '💘', '💝', '💖', '💗', '💓', '💞', '💕', '💟', '❣️', '💔', '❤️', '🧡', '💛', '💚', '💙',
    '💜', '🤎', '🖤', '🤍', '💯', '💢', '💥', '💫', '💦', '💨', '🕳️', '💣', '💬', '👁️‍🗨️', '🗨️', '🗯️',
    '💭', '💤', '🌞', '🌝', '🌛', '🌜', '🌚', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '🌙',
    '☀️', '⭐', '🌟', '💫', '✨', '⚡', '☄️', '💥', '🔥', '💧', '💦', '☔', '☂️', '⛄', '☃️', '❄️',
    '🌈', '🌸', '💐', '🍀', '🌿', '🍁', '🍂', '🍃', '☘️', '🌺', '🌻', '🌹', '🥀', '🌷', '🌼', '🌾',
  ],
  Gestures: [
    '👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋',
    '🤚', '🖐️', '🖖', '👋', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🖕', '✊', '👊', '🤛', '🤜',
    '👏', '🙌', '🫶', '🤲', '🤝', '👐', '🤞', '🫰', '👣', '🦶', '🦵', '💃', '🕺', '👯', '🫂',
  ],
  People: [
    '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '👩', '🧓', '👴', '👵', '🙍', '🙎', '🙅', '🙆',
    '💁', '🙋', '🧏', '🙇', '🤦', '🤷', '🚶', '🧍', '🧎', '🏃', '💃', '🕺', '👯', '🧖', '🧗', '🤺',
    '🏇', '⛷️', '🏂', '🏌️', '🏄', '🚣', '🏊', '⛹️', '🏋️', '🚴', '🚵', '🤸', '🤼', '🤽', '🤾', '🤹',
    '🧘', '🛀', '🛌', '👭', '👫', '👬', '💏', '💑', '👪', '🕴️', '🧑‍🎤', '👮', '🕵️', '👷', '🤴', '👸',
    '👳', '👲', '🧕', '🧔', '👰', '🤵', '👼', '🤰', '🫃', '🫄', '🤱', '👼', '🎅', '🧑‍🎄', '🎓', '🧑‍🏫',
  ],
  Animals: [
    '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵',
    '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋',
    '🐌', '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷️', '🕸️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕',
    '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓',
    '🦍', '🦧', '🦣', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🦬', '🐃', '🐂', '🐄', '🐎', '🐖',
    '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐈', '🐓', '🦃', '🦤', '🦚', '🦜', '🦢', '🦩',
  ],
  Food: [
    '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥',
    '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🧄', '🧅', '🥔', '🍠', '🥐',
    '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟',
    '🍕', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣',
    '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧',
    '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '🫖',
    '☕', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊',
  ],
  Activities: [
    '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍',
    '🏏', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿',
    '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽', '🚣',
    '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️', '🎫', '🎟️', '🎪', '🤹', '🎭',
    '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟️', '🎯', '🎳',
  ],
  Travel: [
    '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🦯', '🦽',
    '🦼', '🛴', '🚲', '🛵', '🏍️', '🛺', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋',
    '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩️', '💺', '🛰️',
    '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '⚓', '🪝', '⛽', '🚧', '🚦', '🚥', '🗺️',
    '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️',
    '🌄', '🌅', '🌇', '🌆', '🏙️', '🌃', '🌌', '🌉', '🌁', '🏡', '🏠', '🏘️', '🏚️', '🏗️', '🏭', '🏬',
  ],
  Objects: [
    '👓', '🕶️', '🥽', '👔', '👕', '👖', '🧣', '🧤', '🧥', '🧦', '👗', '👘', '🥻', '🩱', '🩲', '🩳',
    '👙', '👚', '👛', '👜', '👝', '🎒', '🩴', '👞', '👟', '🥾', '🥿', '👠', '👡', '🩰', '👢', '⛑️',
    '🎩', '🎓', '🧢', '👑', '💍', '👒', '🎷', '📱', '💻', '⌨️', '🖥️', '🖨️', '⌚', '📷', '🎥', '📽️',
    '🎬', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏰', '⏲️', '🌡️', '📱', '💾', '💿', '📀', '🎞️', '📼',
    '📹', '🔋', '🪫', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🗑️', '🛢️', '⚖️', '🪜', '🧰', '🪛', '🔧',
    '🔨', '⚒️', '🛠️', '⛏️', '🪚', '🔩', '⚙️', '🪤', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️',
    '🛡️', '🚬', '⚰️', '🪦', '🧿', '🪬', '🗿', '🪧', '📦', '📭', '📬', '📮', '🗳️', '✉️', '📩', '📨',
    '📧', '💌', '📥', '📤', '📦', '📪', '📫', '📮', '🗂️', '📁', '📂', '🗞️', '📰', '📑', '🔖', '🏷️',
  ],
  Symbols: [
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💔', '❌', '⭕', '🛑', '⛔', '📛', '🚫',
    '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️',
    '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐',
    '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🛗', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹',
    '🚺', '🚼', '⚧️', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒',
    '🆕', '🆓', '🈵', '🈹', '🈺', '🈯', '🈳', '🉐', '🈁', '🈶', '🈚', '🔴', '🟠', '🟡', '🟢', '🔵',
    '🟣', '🟤', '⚫', '⚪', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '🟫', '⬛', '⬜', '◼️', '◻️', '◾',
    '◽', '▪️', '▫️', '🔶', '🔷', '🔸', '🔹', '🔺', '🔻', '💠', '🔘', '🔳', '🔲', '♈', '♉', '♊',
    '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '⛎', '🔀', '🔁', '🔂', '🕐', '🕑', '🕒',
  ],
};

export default function EmojiPicker({ onSelect, onClose }) {
  const [recent, setRecent] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    } catch {
      return [];
    }
  });
  const [query, setQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState(0);

  const rootRef = useRef(null);
  const listRef = useRef(null);
  const groupRefs = useRef({});

  useEffect(() => {
    const onClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [onClose]);

  const saveRecent = (emoji) => {
    const next = [emoji, ...recent.filter((e) => e !== emoji)].slice(0, RECENT_LIMIT);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
  };

  const handlePick = (emoji) => {
    saveRecent(emoji);
    onSelect(emoji);
  };

  const scrollToGroup = (index) => {
    setActiveGroup(index);
    if (index === 0) {
      listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      groupRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const q = query.trim().toLowerCase();
  const allEmoji = Object.values(EMOJI_ITEMS).flat();
  const filtered = q ? allEmoji.filter((e) => e.toLowerCase().includes(q)) : null;
  const groups = Object.entries(EMOJI_ITEMS);

  return (
    <div className="emoji-picker" ref={rootRef}>
      <div className="emoji-search">
        <span className="emoji-search-icon"><SearchIcon size={14} /></span>
        <input
          type="text"
          className="emoji-search-input"
          placeholder="Search emoji…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="emoji-list" ref={listRef}>
        {q ? (
          <div className="emoji-group">
            <div className="emoji-grid">
              {filtered.length === 0 && <div className="emoji-no-results">No emoji found</div>}
              {filtered.slice(0, 120).map((e, i) => (
                <button key={`${e}-${i}`} type="button" className="emoji-btn" onClick={() => handlePick(e)}>{e}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {recent.length > 0 && (
              <div className="emoji-group" ref={(el) => (groupRefs.current[0] = el)}>
                <div className="emoji-group-label">Recent</div>
                <div className="emoji-grid">
                  {recent.map((e) => (
                    <button key={e} type="button" className="emoji-btn" onClick={() => handlePick(e)}>{e}</button>
                  ))}
                </div>
              </div>
            )}
            {groups.map(([name, items], i) => (
              <div
                key={name}
                className="emoji-group"
                ref={(el) => (groupRefs.current[i + (recent.length > 0 ? 1 : 0)] = el)}
              >
                <div className="emoji-group-label">{name}</div>
                <div className="emoji-grid">
                  {items.map((e) => (
                    <button key={e} type="button" className="emoji-btn" onClick={() => handlePick(e)}>{e}</button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="emoji-tabs">
        <button
          type="button"
          className={`emoji-tab ${activeGroup === 0 && !q ? 'active' : ''}`}
          onClick={() => scrollToGroup(0)}
          title="Recent"
        >
          🕘
        </button>
        {EMOJI_GROUPS.filter((g, i) => i > 0).map((g, i) => (
          <button
            key={g.name}
            type="button"
            className={`emoji-tab ${!q && activeGroup === i + (recent.length > 0 ? 1 : 0) ? 'active' : ''}`}
            onClick={() => scrollToGroup(i + (recent.length > 0 ? 1 : 0))}
            title={g.name}
          >
            {g.icon}
          </button>
        ))}
      </div>
    </div>
  );
}
