/**
 * Contrato de `GET /api/settings/webhook` (Fase 1 multitenant, H7): la
 * organización de la plataforma recibe la URL y el token; las demás, solo que
 * el webhook lo administra la plataforma.
 */
export type WebhookSettingsDto =
  | {
      managedByPlatform: false;
      platformConfigMissing: false;
      url: string;
      instagramUrl: string | null;
      messengerUrl: string | null;
      verifyToken: string;
      isHttps: boolean;
      signatureLayer: boolean;
    }
  | {
      managedByPlatform: true;
      /** true = falta PLATFORM_ORG_ID: nadie puede ver el token. */
      platformConfigMissing: boolean;
      signatureLayer: boolean;
    };
