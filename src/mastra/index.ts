import { Mastra } from '@mastra/core/mastra';
import { SimpleAuth } from '@mastra/core/server';
import { MastraPlatformExporter, Observability } from '@mastra/observability';
import { LibSQLStore } from '@mastra/libsql';
import { devAgent } from './agents/dev-agent';
import { appRoutes } from './routes/app';
import { trackRuns } from './runs';

type User = { id: string; name: string };

// Placeholder sign-in: API tokens mapped to users, read from APP_USERS as
// {"<token>": {"id": "...", "name": "..."}}. Swap in your identity provider
// (Clerk, WorkOS, Auth0, ...) and keep `mapUserToResourceId`.
const users = JSON.parse(process.env.APP_USERS ?? '{}') as Record<string, User>;

export const mastra = new Mastra({
  agents: { devAgent },
  // On Platform, attach a Turso database (`mastra env db create --kind turso`)
  // and its connection variables are injected. Locally this is a file.
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: process.env.TURSO_DATABASE_URL ?? 'file:./mastra.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  }),
  server: {
    apiRoutes: appRoutes,
    auth: new SimpleAuth<User>({
      tokens: users,
      // The signed-in user becomes the memory resource id. The server sets it
      // in a reserved request context key that clients can't override, and
      // rejects access to other users' threads. Sandboxes are keyed by it too.
      mapUserToResourceId: user => user.id,
    }),
  },
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'agent-threads',
        exporters: [new MastraPlatformExporter()],
      },
    },
  }),
});

// Records which threads are running, so after a restart the app can show the
// ones that were cut off.
trackRuns(mastra.getAgentById('dev'));
