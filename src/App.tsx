import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { ToastProvider } from './lib/toast'
import LeagueLayout from './components/LeagueLayout'
import { Loading } from './components/ui'

import SignIn from './routes/SignIn'
import MyLeagues from './routes/MyLeagues'
import NewLeague from './routes/NewLeague'
import JoinLeague from './routes/JoinLeague'
import Lobby from './routes/Lobby'
import DraftRoom from './routes/DraftRoom'
import Squad from './routes/Squad'
import Players from './routes/Players'
import Trades from './routes/Trades'
import Table from './routes/Table'
import Commissioner from './routes/Commissioner'
import ChatPage from './routes/ChatPage'

function Gate ({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth()
  if (loading) return <div className="page mt-40"><Loading /></div>
  return session ? children : <Navigate to="/signin" replace />
}

export default function App () {
  return (
    // Real paths, not hash routes — vercel.json rewrites every unknown path to
    // index.html, so deep links and hard refreshes resolve.
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route path="/join/:code?" element={<Gate><JoinLeague /></Gate>} />
            <Route path="/new" element={<Gate><NewLeague /></Gate>} />
            <Route path="/" element={<Gate><MyLeagues /></Gate>} />

            <Route path="/l/:leagueId" element={<Gate><LeagueLayout /></Gate>}>
              <Route index element={<Lobby />} />
              <Route path="draft" element={<DraftRoom />} />
              <Route path="team" element={<Squad />} />
              <Route path="team/:memberId" element={<Squad />} />
              <Route path="players" element={<Players />} />
              <Route path="trades" element={<Trades />} />
              <Route path="table" element={<Table />} />
              <Route path="chat" element={<ChatPage />} />
              <Route path="commissioner" element={<Commissioner />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
