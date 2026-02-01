import { z } from 'zod';

export const DeployConfigSchema = z.object({
  vercel: z.object({
    token: z.string(),
    teamId: z.string().optional(),
  }),
  github: z.object({
    token: z.string(),
    org: z.string().default('captain-earl'),
  }),
  redis: z.object({
    url: z.string().default('redis://localhost:6379'),
  }),
  webhook: z.object({
    secret: z.string(),
    port: z.number().default(3000),
  }),
  agents: z.array(z.object({
    name: z.string(),
    repo: z.string(),
    vercelProjectId: z.string(),
    autoDeploy: z.boolean().default(true),
    branches: z.array(z.string()).default(['main']),
  })),
});

export type DeployConfig = z.infer<typeof DeployConfigSchema>;

// Agent registry - all deployable agents
export const agents = [
  {
    name: 'edna',
    repo: 'edna-ghl-agent',
    vercelProjectId: '',
    autoDeploy: true,
    branches: ['main'],
  },
  {
    name: 'mabel',
    repo: 'mabel-lead-agent',
    vercelProjectId: '',
    autoDeploy: true,
    branches: ['main'],
  },
  {
    name: 'otis',
    repo: 'otis-seo-agent',
    vercelProjectId: '',
    autoDeploy: true,
    branches: ['main'],
  },
  {
    name: 'harold',
    repo: 'harold-finance-agent',
    vercelProjectId: '',
    autoDeploy: true,
    branches: ['main'],
  },
];

export function getConfig(): DeployConfig {
  return DeployConfigSchema.parse({
    vercel: {
      token: process.env.VERCEL_TOKEN,
      teamId: process.env.VERCEL_TEAM_ID,
    },
    github: {
      token: process.env.GITHUB_TOKEN,
      org: process.env.GITHUB_ORG || 'captain-earl',
    },
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
    },
    webhook: {
      secret: process.env.WEBHOOK_SECRET || 'dev-secret',
      port: parseInt(process.env.PORT || '3000'),
    },
    agents,
  });
}
