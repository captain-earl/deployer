import express from 'express';
import { Queue } from 'bullmq';
import { getConfig, agents } from './config.js';
import { logger } from './utils/logger.js';
import crypto from 'crypto';

const app = express();
const config = getConfig();

// Deployment queue
const deployQueue = new Queue('deployments', {
  connection: { url: config.redis.url },
});

app.use(express.json());

// Verify GitHub webhook signature
function verifySignature(payload: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'deployer' });
});

// List registered agents
app.get('/agents', (req, res) => {
  res.json({ agents });
});

// GitHub webhook handler
app.post('/webhook/github', async (req, res) => {
  const signature = req.headers['x-hub-signature-256'] as string;
  const payload = JSON.stringify(req.body);
  
  if (!verifySignature(payload, signature, config.webhook.secret)) {
    logger.warn('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.headers['x-github-event'] as string;
  
  if (event === 'push') {
    const { ref, repository, commits } = req.body;
    const branch = ref.replace('refs/heads/', '');
    const repoName = repository.name;
    
    logger.info({ repo: repoName, branch, commits: commits.length }, 'Push received');
    
    // Find matching agent
    const agent = agents.find(a => a.repo === repoName);
    
    if (!agent) {
      logger.warn({ repo: repoName }, 'Unknown agent repository');
      return res.status(200).json({ ignored: true, reason: 'unknown repo' });
    }
    
    if (!agent.branches.includes(branch)) {
      logger.info({ repo: repoName, branch }, 'Branch not configured for auto-deploy');
      return res.status(200).json({ ignored: true, reason: 'branch not configured' });
    }
    
    if (!agent.autoDeploy) {
      logger.info({ agent: agent.name }, 'Auto-deploy disabled for this agent');
      return res.status(200).json({ ignored: true, reason: 'auto-deploy disabled' });
    }
    
    // Queue deployment
    const job = await deployQueue.add('deploy', {
      agent: agent.name,
      repo: repoName,
      branch,
      commit: commits[0]?.id || 'unknown',
      commitMessage: commits[0]?.message || '',
      timestamp: new Date().toISOString(),
    }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });
    
    logger.info({ jobId: job.id, agent: agent.name }, 'Deployment queued');
    
    res.json({ 
      queued: true, 
      jobId: job.id,
      agent: agent.name,
      branch,
    });
  } else {
    res.json({ received: true, event });
  }
});

// Manual deploy trigger
app.post('/deploy/:agent', async (req, res) => {
  const agentName = req.params.agent;
  const agent = agents.find(a => a.name === agentName);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const job = await deployQueue.add('deploy', {
    agent: agent.name,
    repo: agent.repo,
    branch: req.body.branch || 'main',
    manual: true,
    timestamp: new Date().toISOString(),
  }, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  });
  
  logger.info({ jobId: job.id, agent: agent.name }, 'Manual deployment queued');
  
  res.json({
    queued: true,
    jobId: job.id,
    agent: agent.name,
  });
});

// Get deployment status
app.get('/deploy/:jobId/status', async (req, res) => {
  const job = await deployQueue.getJob(req.params.jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  const state = await job.getState();
  
  res.json({
    id: job.id,
    state,
    data: job.data,
    result: job.returnvalue,
    failedReason: job.failedReason,
    attemptsMade: job.attemptsMade,
  });
});

const PORT = config.webhook.port;
app.listen(PORT, () => {
  logger.info(`Deployer webhook server running on port ${PORT}`);
  logger.info(`Registered ${agents.length} agents`);
});
