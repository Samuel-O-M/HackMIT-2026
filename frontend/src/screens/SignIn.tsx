import { useRef, useState } from 'react';
import { DEMO_HINT, type SignInResult } from '../auth';
import { PRODUCT_NAME, SITE_LABEL } from '../brand';
import { usingFixtures } from '../api';

interface Props {
  onSubmit: (username: string, password: string) => SignInResult;
}

export function SignIn({ onSubmit }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const userField = useRef<HTMLInputElement>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = onSubmit(username, password);
    if (!result.ok) {
      setError(result.reason);
      setPassword('');
      userField.current?.focus();
    }
  }

  return (
    <div className="signin">
      <form className="signin-card" onSubmit={submit} noValidate>
        <div className="signin-mark">
          <b>{PRODUCT_NAME}</b>
          <span>{SITE_LABEL}</span>
        </div>

        <div className="signin-body">
          <h1>Sign in</h1>
          <p className="signin-lede">
            Reviewing a reconciliation writes to the study record, so every change is attributed to
            the coordinator who made it.
          </p>

          <label className="signin-field">
            <span>Username</span>
            <input
              ref={userField}
              name="username"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError(null);
              }}
              aria-invalid={error !== null}
              aria-describedby={error ? 'signin-error' : undefined}
            />
          </label>

          <label className="signin-field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              aria-invalid={error !== null}
              aria-describedby={error ? 'signin-error' : undefined}
            />
          </label>

          {error && (
            <p className="signin-error" id="signin-error" role="alert">
              {error}
            </p>
          )}

          <button className="btn btn-primary signin-submit" type="submit">
            Sign in
          </button>

          {usingFixtures && (
            <p className="signin-demo">
              Demo build · sign in with <span className="mono">{DEMO_HINT}</span>
            </p>
          )}
        </div>
      </form>
    </div>
  );
}
