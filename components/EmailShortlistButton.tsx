'use client';

import { useState } from 'react';
import styles from './EmailShortlistButton.module.css';

type Status = 'idle' | 'loading' | 'success' | 'error';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailShortlistButton({ sessionId }: { sessionId: string }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const isEmailValid = EMAIL_RE.test(email);

  async function handleClick() {
    if (!isEmailValid) return;
    setStatus('loading');
    setErrorMessage('');

    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, email }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setStatus('error');
        setErrorMessage(data.error ?? 'Something went wrong. Please try again.');
        return;
      }

      setStatus('success');
    } catch {
      setStatus('error');
      setErrorMessage('Could not reach the server. Please try again.');
    }
  }

  return (
    <div className={styles.container}>
      <input
        type="email"
        className={styles.input}
        aria-label="Email address"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (status !== 'idle') setStatus('idle');
        }}
        disabled={status === 'loading'}
      />
      <button className={styles.button} onClick={handleClick} disabled={!isEmailValid || status === 'loading'}>
        {status === 'loading' ? 'Sending…' : 'Email me this shortlist'}
      </button>
      {!isEmailValid && email.length > 0 && (
        <p role="alert" className={styles.error}>
          Enter a valid email address.
        </p>
      )}
      {status === 'success' && <p className={styles.success}>Shortlist sent! Check your inbox.</p>}
      {status === 'error' && (
        <p role="alert" className={styles.error}>
          {errorMessage}
        </p>
      )}
    </div>
  );
}
