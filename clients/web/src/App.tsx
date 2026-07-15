import { BrowserRouter } from "react-router-dom";
import { AppRouter } from "@/app/AppRouter";
import { AuthProvider } from "@/auth/AuthProvider";
import { DaemonClientProvider } from "@/auth/DaemonClientProvider";
import { createDaemonClient } from "@/lib/client";

const daemonClient = createDaemonClient();

// The application root owns the single daemon client and route/auth providers.
export function App() {
  return <BrowserRouter><DaemonClientProvider client={daemonClient}><AuthProvider client={daemonClient}><AppRouter /></AuthProvider></DaemonClientProvider></BrowserRouter>;
}
