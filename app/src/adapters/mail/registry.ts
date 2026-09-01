// The mail provider registry (T3.3-CORRECTION).
//
// The application asks this for "the providers this deployment has", never for
// "the provider". Every provider is listed whether or not it is configured, and
// an unconfigured one is listed WITH THE REASON — so the settings surface can
// show a disabled option that explains itself instead of a button that fails
// after it is pressed. Executability is a state here too.

import type { MailProvider, MailProviderRegistry } from '../../ports/mail.ts';
import {
  GOOGLE_PROFILE,
  MICROSOFT_PROFILE,
  makeOAuthMailProvider,
  type OAuthCredentials,
  type OAuthProviderProfile,
} from './oauth-mail-provider.ts';

export interface MailRegistryConfig {
  readonly google: OAuthCredentials;
  readonly microsoft: OAuthCredentials;
}

export function makeMailProviderRegistry(cfg: MailRegistryConfig): MailProviderRegistry {
  const built: Array<[OAuthProviderProfile, OAuthCredentials]> = [
    [GOOGLE_PROFILE, cfg.google],
    [MICROSOFT_PROFILE, cfg.microsoft],
  ];
  const providers = new Map<string, MailProvider>(
    built.map(([profile, credentials]) => [
      profile.id,
      makeOAuthMailProvider(profile, credentials),
    ]),
  );

  return {
    list() {
      return [...providers.values()].map((p) => p.describe());
    },
    get(id: string): MailProvider | null {
      return providers.get(id) ?? null;
    },
  };
}

/** A registry over an explicit provider set — used by tests and by any
 *  deployment that wires its own providers. */
export function makeStaticMailProviderRegistry(
  providers: readonly MailProvider[],
): MailProviderRegistry {
  const byId = new Map(providers.map((p) => [p.describe().id as string, p]));
  return {
    list: () => providers.map((p) => p.describe()),
    get: (id: string) => byId.get(id) ?? null,
  };
}
