// Getypeerde endpoint-helpers boven op apiVerzoek. Elke functie retourneert
// exact het wire-type uit @mondzorgwerkt/api-contract.

import type {
  ApplicationsResponse,
  ApplyRequest,
  AuthResponse,
  ConsentRevokeRequest,
  ConsentsResponse,
  InterviewConfirmRequest,
  InterviewsResponse,
  InvitationRespondRequest,
  InvitationsResponse,
  LoginRequest,
  MatchDetailResponse,
  MatchesResponse,
  MeResponse,
  NotificationPreferencesResponse,
  NotificationPreferenceUpdateRequest,
  NotificationsResponse,
  OkResponse,
  PrivacyOverviewResponse,
  ProfileResponse,
  ProfileStepRequest,
  PublicJobSearchResult,
  RegisterRequest,
  WithdrawRequest,
} from "@mondzorgwerkt/api-contract";
import { apiVerzoek, enkeleVlucht } from "./api";

const V1 = "/api/mobile/v1";

// ---- auth (tokens gaan via SessionProvider naar SecureStore) ----
export const authApi = {
  register: (body: RegisterRequest) =>
    enkeleVlucht("auth-register", () =>
      apiVerzoek<AuthResponse>(`${V1}/auth/register`, {
        method: "POST",
        body,
        publiek: true,
      }),
    ),
  login: (body: LoginRequest) =>
    enkeleVlucht("auth-login", () =>
      apiVerzoek<AuthResponse>(`${V1}/auth/login`, {
        method: "POST",
        body,
        publiek: true,
      }),
    ),
  logout: () =>
    apiVerzoek<OkResponse>(`${V1}/auth/logout`, { method: "POST", body: {} }),
};

// ---- openbaar zoeken (bestaande publieke API) ----
export interface PubliekeZoekFilters {
  role?: string;
  city?: string;
  employmentType?: string;
  page?: number;
}

export const publicApi = {
  zoekVacatures: (filters: PubliekeZoekFilters = {}) => {
    const query = new URLSearchParams();
    if (filters.role) query.set("role", filters.role);
    if (filters.city) query.set("city", filters.city);
    if (filters.employmentType) query.set("employmentType", filters.employmentType);
    if (filters.page) query.set("page", String(filters.page));
    const qs = query.toString();
    return apiVerzoek<PublicJobSearchResult>(
      `/api/public/v1/jobs${qs ? `?${qs}` : ""}`,
      { publiek: true },
    );
  },
  vacature: (idOrSlug: string) =>
    apiVerzoek<unknown>(`/api/public/v1/jobs/${encodeURIComponent(idOrSlug)}`, {
      publiek: true,
    }),
};

// ---- kandidaat ----
export const kandidaatApi = {
  me: () => apiVerzoek<MeResponse>(`${V1}/me`),
  profiel: () => apiVerzoek<ProfileResponse>(`${V1}/profile`),
  bewaarStap: (body: ProfileStepRequest) =>
    enkeleVlucht(`profiel-stap-${body.stepName}`, () =>
      apiVerzoek<ProfileResponse>(`${V1}/profile/step`, { method: "PUT", body }),
    ),
  activeer: () =>
    enkeleVlucht("profiel-activeren", () =>
      apiVerzoek<ProfileResponse>(`${V1}/profile/activate`, {
        method: "POST",
        body: {},
      }),
    ),

  matches: () => apiVerzoek<MatchesResponse>(`${V1}/matches`),
  matchDetail: (vacancyId: string) =>
    apiVerzoek<MatchDetailResponse>(
      `${V1}/matches/${encodeURIComponent(vacancyId)}`,
    ),

  sollicitaties: () => apiVerzoek<ApplicationsResponse>(`${V1}/applications`),
  solliciteer: (body: ApplyRequest) =>
    enkeleVlucht(`solliciteer-${body.vacancyId}`, () =>
      apiVerzoek<{ application: { id: string; status: string } }>(
        `${V1}/applications`,
        { method: "POST", body },
      ),
    ),
  trekTerug: (applicationId: string, body: WithdrawRequest) =>
    enkeleVlucht(`terugtrekken-${applicationId}`, () =>
      apiVerzoek<{ application: { id: string; status: string } }>(
        `${V1}/applications/${encodeURIComponent(applicationId)}/withdraw`,
        { method: "POST", body },
      ),
    ),

  uitnodigingen: () => apiVerzoek<InvitationsResponse>(`${V1}/invitations`),
  uitnodigingenGezien: () =>
    apiVerzoek<OkResponse>(`${V1}/invitations/viewed`, { method: "POST", body: {} }),
  beantwoordUitnodiging: (invitationId: string, body: InvitationRespondRequest) =>
    enkeleVlucht(`uitnodiging-${invitationId}`, () =>
      apiVerzoek<{ invitation: { id: string; status: string } }>(
        `${V1}/invitations/${encodeURIComponent(invitationId)}/respond`,
        { method: "POST", body },
      ),
    ),

  consents: () => apiVerzoek<ConsentsResponse>(`${V1}/consents`),
  trekConsentIn: (body: ConsentRevokeRequest) =>
    enkeleVlucht(`consent-${body.organizationId}-${body.vacancyId ?? "org"}`, () =>
      apiVerzoek<OkResponse>(`${V1}/consents/revoke`, { method: "POST", body }),
    ),

  gesprekken: () => apiVerzoek<InterviewsResponse>(`${V1}/interviews`),
  bevestigGesprek: (interviewId: string, body: InterviewConfirmRequest) =>
    enkeleVlucht(`gesprek-${interviewId}`, () =>
      apiVerzoek<{ interview: { id: string; status: string; chosenSlot: string | null } }>(
        `${V1}/interviews/${encodeURIComponent(interviewId)}/confirm`,
        { method: "POST", body },
      ),
    ),

  notificaties: () => apiVerzoek<NotificationsResponse>(`${V1}/notifications`),
  allesGelezen: () =>
    apiVerzoek<OkResponse>(`${V1}/notifications/read-all`, {
      method: "POST",
      body: {},
    }),
  notificatieVoorkeuren: () =>
    apiVerzoek<NotificationPreferencesResponse>(`${V1}/notifications/preferences`),
  bewaarNotificatieVoorkeur: (body: NotificationPreferenceUpdateRequest) =>
    apiVerzoek<OkResponse>(`${V1}/notifications/preferences`, {
      method: "PUT",
      body,
    }),

  registreerPushToken: (token: string) =>
    apiVerzoek<OkResponse>(`${V1}/push-tokens`, {
      method: "POST",
      body: { token, platform: "ios" },
    }),
  verwijderPushToken: (token: string) =>
    apiVerzoek<OkResponse>(`${V1}/push-tokens`, {
      method: "DELETE",
      body: { token },
    }),

  privacyOverzicht: () => apiVerzoek<PrivacyOverviewResponse>(`${V1}/privacy/overview`),
  verwijderAccount: () =>
    enkeleVlucht("account-verwijderen", () =>
      apiVerzoek<OkResponse>(`${V1}/account`, {
        method: "DELETE",
        body: { confirm: "verwijderen" },
      }),
    ),
};
