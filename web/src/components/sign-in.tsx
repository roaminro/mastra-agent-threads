import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, setToken } from '@/lib/api';

/** Placeholder sign-in: an API token from APP_USERS on the server. */
export function SignIn({ onSignIn }: { onSignIn: (token: string, resourceId: string) => void }) {
  const [token, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid h-screen place-items-center bg-background text-foreground">
      <form
        className="flex w-80 flex-col gap-3"
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
        <h1 className="text-lg font-semibold">
          agent<span className="text-sky-400">threads</span>
        </h1>
        <Label htmlFor="token">Access token</Label>
        <Input id="token" type="password" value={token} onChange={e => setValue(e.target.value)} autoFocus />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={!token}>
          Sign in
        </Button>
      </form>
    </div>
  );
}
