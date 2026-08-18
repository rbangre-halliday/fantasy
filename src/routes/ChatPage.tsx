import { useLeague } from '../components/LeagueLayout'
import Chat from '../components/Chat'
import { PageHead } from '../components/ui'

export default function ChatPage () {
  const { league, members, me, isCommissioner } = useLeague()

  return (
    <div className="page narrow">
      <PageHead
        title="Chat"
        meta="Everyone in the league can see this. Deleting your own message removes it for everyone." />
      <Chat
        leagueId={league.id}
        members={members}
        meId={me.id}
        isCommissioner={isCommissioner}
      />
    </div>
  )
}
