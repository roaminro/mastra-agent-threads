import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Logo } from '@/components/logo';
import { api, setToken } from '@/lib/api';

/** Placeholder sign-in: an API token from APP_USERS on the server. */
export function SignIn({ onSignIn }: { onSignIn: (token: string, resourceId: string) => void }) {
  const [token, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid h-screen place-items-center bg-background text-foreground">
      <form
        className="flex w-80 flex-col gap-2"
        onSubmit={async event => {
          event.preventDefault();
          try {
            const { resourceId } = await api<{ resourceId: string }>('/app/me', { token });
            setToken(token);
            onSignIn(token, resourceId);
          } catch {
            setError("That token didn't work.");
          }
        }}
      >
        <Logo />
        <p className="mb-3 text-sm text-muted-foreground">Agents that start agents, each with its own sandbox.</p>
        <Label htmlFor="token" className="font-mono text-xs font-normal text-faint">
          access token
        </Label>
        <Input id="token" type="password" className="font-mono" value={token} onChange={e => setValue(e.target.value)} autoFocus />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={!token}>
          Sign in
        </Button>
      </form>
    </div>
  );
}
