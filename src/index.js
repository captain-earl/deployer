import express from 'express';
import { Queue } from 'bullmq';
import { getConfig, agents } from './config.js';
import crypto from 'crypto';

const app = express();
const config = getConfig();

// Deployment queue
const deployQueue = new Queue('deployments', {
  connection: { url: config.redis.url },
});

app.use(express.json());

// Verify GitHub webhook signature
function verifySignature(payload, signature, secret) {
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
  const signature = req.headers['x-hub-signature-256'];
  const payload = JSON.stringify(req.body);
  
  if (!verifySignature(payload, signature, config.webhook.secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.headers['x-github-event'];
  
  if (event === 'push') {
    const { ref, repository, commits } = req.body;
    const branch = ref.replace('refs/heads/', '');
    const repoName = repository.name;
    
    const agent = agents.find(a => a.repo === repoName);
    
    if (!agent) {
      return res.status(200).json({ ignored: true, reason: 'unknown repo' });
    }
    
    if (!agent.branches.includes(branch)) {
      return res.status(200).json({ ignored: true, reason: 'branch not configured' });
    }
    
    if (!agent.autoDeploy) {
      return res.status(200).json({ ignored: true, reason: 'auto-deploy disabled' });
    }
    
    const job = await deployQueue.add('deploy', {
      agent: agent.name,
      repo: repoName,
      branch,
      commit: commits[0]?.id || 'unknown',
      timestamp: new Date().toISOString(),
    }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
    
    res.json({ queued: true, jobId: job.id, agent: agent.name, branch });
  } else {
    res.json({ received: true, event });
  }
});

// Manual deploy trigger
app.post('/deploy/:agent', async (req, res) => {
  const agent = agents.find(a => a.name === req.params.agent);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  
  const job = await deployQueue.add('deploy', {
    agent: agent.name,
    repo: agent.repo,
    branch: req.body.branch || 'main',
    manual: true,
    timestamp: new Date().toISOString(),
  }, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
  
  res.json({ queued: true, jobId: job.id, agent: agent.name });
});

// Get deployment status
app.get('/deploy/:jobId/status', async (req, res) => {
  const job = await deployQueue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  
  const state = await job.getState();
  res.json({ id: job.id, state, data: job.data, result: job.returnvalue, failedReason: job.failedReason });
});

const PORT = config.webhook.port;
app.listen(PORT, () => {
  console.log(`Deployer webhook server running on port ${PORT}`);
});

export default app;
