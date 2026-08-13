import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflowPath = resolve(__dirname, 'shortlist-to-pdf-email.json');

function loadWorkflow() {
  const raw = readFileSync(workflowPath, 'utf-8');
  return JSON.parse(raw);
}

describe('shortlist-to-pdf-email.json', () => {
  it('is valid JSON with a nodes array and a connections object', () => {
    const workflow = loadWorkflow();
    expect(Array.isArray(workflow.nodes)).toBe(true);
    expect(workflow.nodes.length).toBeGreaterThan(0);
    expect(typeof workflow.connections).toBe('object');
    expect(workflow.connections).not.toBeNull();
  });

  it('contains one node of each required type', () => {
    const workflow = loadWorkflow();
    const types = workflow.nodes.map((n: any) => n.type);

    expect(types).toContain('n8n-nodes-base.webhook');
    expect(types).toContain('n8n-nodes-base.code');
    expect(types).toContain('n8n-nodes-puppeteer.puppeteer');
    expect(types).toContain('n8n-nodes-base.emailSend');
    expect(types).toContain('n8n-nodes-base.respondToWebhook');
  });

  it('connects the nodes webhook -> code -> pdf -> email -> respond, in order', () => {
    const workflow = loadWorkflow();

    function nextNodeName(name: string): string | undefined {
      return workflow.connections[name]?.main?.[0]?.[0]?.node;
    }

    const webhookNode = workflow.nodes.find((n: any) => n.type === 'n8n-nodes-base.webhook');
    const codeNode = workflow.nodes.find((n: any) => n.type === 'n8n-nodes-base.code');
    const pdfNode = workflow.nodes.find((n: any) => n.type === 'n8n-nodes-puppeteer.puppeteer');
    const emailNode = workflow.nodes.find((n: any) => n.type === 'n8n-nodes-base.emailSend');
    const respondNode = workflow.nodes.find((n: any) => n.type === 'n8n-nodes-base.respondToWebhook');

    expect(webhookNode).toBeDefined();
    expect(codeNode).toBeDefined();
    expect(pdfNode).toBeDefined();
    expect(emailNode).toBeDefined();
    expect(respondNode).toBeDefined();

    expect(nextNodeName(webhookNode.name)).toBe(codeNode.name);
    expect(nextNodeName(codeNode.name)).toBe(pdfNode.name);
    expect(nextNodeName(pdfNode.name)).toBe(emailNode.name);
    expect(nextNodeName(emailNode.name)).toBe(respondNode.name);
  });

  it('references SMTP credentials by name only, with no inline secrets', () => {
    const workflow = loadWorkflow();
    const emailNode = workflow.nodes.find((n: any) => n.type === 'n8n-nodes-base.emailSend');

    expect(emailNode.credentials?.smtp?.name).toBeTruthy();

    const serialized = JSON.stringify(emailNode).toLowerCase();
    expect(serialized).not.toMatch(/password|smtp_pass|apikey|api_key/);
  });

  it('the webhook is configured for POST at the shortlist-pdf path', () => {
    const workflow = loadWorkflow();
    const webhookNode = workflow.nodes.find((n: any) => n.type === 'n8n-nodes-base.webhook');

    expect(webhookNode.parameters.path).toBe('shortlist-pdf');
    expect(webhookNode.parameters.httpMethod).toBe('POST');
  });
});
