/* Private Messaging (FR-7): conversations list, conversation page, and a link from each approved claim. */
import { Link } from 'react-router';
import Conversations from './Conversations';
import Conversation from './Conversation';
import './messaging.css';

function ClaimConversationLink({ claim }) {
  if (!claim.hasConversation) return null;
  return (
    <div className="card panel conversation-link" style={{ maxWidth: 760 }}>
      <span>💬 Private conversation with {claim.isClaimant ? 'the finder' : 'the owner'}</span>
      <Link to={`/conversations/${claim.id}`} className="btn small">Open conversation</Link>
    </div>
  );
}

export default {
  order: 20,
  routes: [
    { path: '/conversations', element: <Conversations /> },
    { path: '/conversations/:id', element: <Conversation /> },
  ],
  nav: [{ to: '/conversations', label: 'Messages', primary: true }],
  claimPanels: [ClaimConversationLink],
};
