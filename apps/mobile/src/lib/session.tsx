// Sessiebeheer: herstel bij het opstarten (splash), in-/uitloggen en de
// afgeleide routeringsstatus (uitgelogd / onboarding / actief). Bij
// uitloggen worden pushtoken, tokens en ALLE lokale caches gewist.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MeResponse, MobileTokens, MobileUser, ProfileView } from "@mondzorgwerkt/api-contract";
import { bijSessieVerlies } from "./api";
import { authApi, kandidaatApi } from "./endpoints";
import { bewaarTokens, leesTokens, wisTokens } from "./secure-tokens";
import { wisCache } from "./cache";
import { meldPushTokenAf } from "./push";

export type SessieStatus =
  | "laden" // splash: sessieherstel bezig
  | "uitgelogd"
  | "onboarding" // ingelogd, profiel ontbreekt of is draft
  | "actief"; // ingelogd met actief profiel

interface SessieContextWaarde {
  status: SessieStatus;
  user: MobileUser | null;
  profile: ProfileView | null;
  login(email: string, password: string, deviceName?: string): Promise<void>;
  registreer(name: string, email: string, password: string, deviceName?: string): Promise<void>;
  vernieuwProfiel(): Promise<void>;
  zetProfiel(profiel: ProfileView | null): void;
  uitloggen(): Promise<void>;
}

const SessieContext = createContext<SessieContextWaarde | null>(null);

function statusUitProfiel(profiel: ProfileView | null): SessieStatus {
  return profiel && profiel.status !== "draft" ? "actief" : "onboarding";
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessieStatus>("laden");
  const [user, setUser] = useState<MobileUser | null>(null);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const bezig = useRef(false);

  const lokaalOpruimen = useCallback(async () => {
    await meldPushTokenAf().catch(() => {});
    await wisTokens();
    wisCache();
    setUser(null);
    setProfile(null);
    setStatus("uitgelogd");
  }, []);

  // Sessieherstel bij koude start.
  useEffect(() => {
    let actueel = true;
    (async () => {
      const tokens = await leesTokens();
      if (!tokens) {
        if (actueel) setStatus("uitgelogd");
        return;
      }
      try {
        const me = await kandidaatApi.me();
        if (!actueel) return;
        setUser(me.user);
        setProfile(me.profile);
        setStatus(statusUitProfiel(me.profile));
      } catch {
        // 401 na refresh-poging → tokens zijn al gewist door de client;
        // netwerkfout → toch naar uitgelogd, inloggen kan altijd opnieuw.
        if (actueel) {
          setUser(null);
          setProfile(null);
          setStatus("uitgelogd");
        }
      }
    })();
    return () => {
      actueel = false;
    };
  }, []);

  // Geforceerd uitloggen wanneer de API-client sessieverlies detecteert.
  useEffect(
    () =>
      bijSessieVerlies(() => {
        wisCache();
        setUser(null);
        setProfile(null);
        setStatus("uitgelogd");
      }),
    [],
  );

  const naInloggen = useCallback(async (tokens: MobileTokens, gebruiker: MobileUser) => {
    await bewaarTokens(tokens);
    setUser(gebruiker);
    const me: MeResponse = await kandidaatApi.me();
    setProfile(me.profile);
    setStatus(statusUitProfiel(me.profile));
  }, []);

  const login = useCallback(
    async (email: string, password: string, deviceName?: string) => {
      if (bezig.current) return;
      bezig.current = true;
      try {
        const res = await authApi.login({ email, password, deviceName, platform: "ios" });
        await naInloggen(res.tokens, res.user);
      } finally {
        bezig.current = false;
      }
    },
    [naInloggen],
  );

  const registreer = useCallback(
    async (name: string, email: string, password: string, deviceName?: string) => {
      if (bezig.current) return;
      bezig.current = true;
      try {
        const res = await authApi.register({
          name,
          email,
          password,
          deviceName,
          platform: "ios",
        });
        await naInloggen(res.tokens, res.user);
      } finally {
        bezig.current = false;
      }
    },
    [naInloggen],
  );

  const vernieuwProfiel = useCallback(async () => {
    const me = await kandidaatApi.me();
    setUser(me.user);
    setProfile(me.profile);
    setStatus(statusUitProfiel(me.profile));
  }, []);

  const zetProfiel = useCallback((profiel: ProfileView | null) => {
    setProfile(profiel);
    setStatus(statusUitProfiel(profiel));
  }, []);

  const uitloggen = useCallback(async () => {
    // Server-side intrekken (best effort) en daarna ALTIJD lokaal opruimen.
    try {
      await authApi.logout();
    } catch {
      // offline uitloggen blijft mogelijk; de sessie is server-side kort-
      // levend (access 30 min) en kan later via apparaatbeheer worden ingetrokken.
    }
    await lokaalOpruimen();
  }, [lokaalOpruimen]);

  const waarde = useMemo(
    () => ({ status, user, profile, login, registreer, vernieuwProfiel, zetProfiel, uitloggen }),
    [status, user, profile, login, registreer, vernieuwProfiel, zetProfiel, uitloggen],
  );

  return <SessieContext.Provider value={waarde}>{children}</SessieContext.Provider>;
}

export function useSessie(): SessieContextWaarde {
  const ctx = useContext(SessieContext);
  if (!ctx) throw new Error("useSessie vereist een SessionProvider");
  return ctx;
}
