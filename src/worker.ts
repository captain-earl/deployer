import { Worker } from 'bullmq';
import { getConfig } from './config.js';
import { logger } from './utils/logger.js';
import { Octokit } from 'octokit';
import { execa } from 'execa';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

const config = getConfig();

const octokit = new Octokit({ auth: config.github.token });

interface DeployJob {
  agent: string;
  repo: string;
  branch: string;
  commit?: string;
  commitMessage?: string;
  manual?: boolean;
  timestamp: string;
}

async function deployAgent(jobData: DeployJob): Promise<{ url: string; deploymentId: string }> {
  const { agent, repo, branch } = jobData;
  
  logger.info({ agent, repo, branch }, 'Starting deployment');
  
  // Create temp directory
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `deploy-${agent}-`));
  
  try {
    // Clone repository
    const repoUrl = `https://${config.github.token}@github.com/${config.github.org}/${repo}.git`;
    
    logger.info({ tmpDir }, 'Cloning repository');
    await execa('git', ['clone', '--depth', '1', '--branch', branch, repoUrl, tmpDir]);
    
    // Check if vercel.json exists
    const vercelConfigPath = path.join(tmpDir, 'vercel.json');
    try {
      await fs.access(vercelConfigPath);
    } catch {
      // Create default vercel.json
      logger.info('Creating default vercel.json');
      await fs.writeFile(vercelConfigPath, JSON.stringify({
        version: 2,
        builds: [{ src: 'dist/index.js', use: '@vercel/node' }],
        routes: [{ src: '/(.*)', dest: 'dist/index.js' }],
      }, null, 2));
    }
    
    // Deploy to Vercel
    logger.info('Deploying to Vercel');
    
    const vercelArgs = [
      '--token', config.vercel.token,
      '--cwd', tmpDir,
      '--yes',
    ];
    
    if (config.vercel.teamId) {
      vercelArgs.push('--scope', config.vercel.teamId);
    }
    
    const { stdout } = await execa('vercel', vercelArgs, { cwd: tmpDir });
    
    // Extract deployment URL
    const deploymentUrl = stdout.trim().split('\n').pop() || '';
    
    logger.info({ agent, url: deploymentUrl }, 'Deployment complete');
    
    // Store deployment info
    const deploymentId = `deploy-${Date.now()}`;
    
    return {
      url: deploymentUrl,
      deploymentId,
    };
  } finally {
    // Cleanup
    logger.info({ tmpDir }, 'Cleaning up');
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

// Create worker
const worker = new Worker<DeployJob>('deployments', async (job) => {
  logger.info({ jobId: job.id, data: job.data }, 'Processing deployment job');
  
  const result = await deployAgent(job.data);
  
  // Notify watcher about new deployment
  // This is handled by the watcher polling or via webhook
  
  return result;
}, {
  connection: { url: config.redis.url },
  concurrency: 2,
});

worker.on('completed', (job, result) => {
  logger.info({ jobId: job?.id, result }, 'Deployment completed');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, 'Deployment failed');
});

logger.info('Deployer worker started');
