import { contextBridge, ipcRenderer } from "electron";
import type {
  Api,
  CreateCampaignInput,
  CreateGameInput,
  CreatePlatformInput,
  LevelFunnelInput,
  PlatformKind,
  TargetBands,
  UpdateCampaignInput,
  UpdateSettingsInput,
} from "@shared/types";

const api: Api = {
  games: {
    list: () => ipcRenderer.invoke("games:list"),
    create: (input: CreateGameInput) => ipcRenderer.invoke("games:create", input),
    delete: (id: string) => ipcRenderer.invoke("games:delete", id),
    get: (id: string) => ipcRenderer.invoke("games:get", id),
  },
  platforms: {
    create: (input: CreatePlatformInput) =>
      ipcRenderer.invoke("platforms:create", input),
    delete: (id: string) => ipcRenderer.invoke("platforms:delete", id),
  },
  campaigns: {
    create: (input: CreateCampaignInput) =>
      ipcRenderer.invoke("campaigns:create", input),
    update: (input: UpdateCampaignInput) =>
      ipcRenderer.invoke("campaigns:update", input),
    delete: (id: string) => ipcRenderer.invoke("campaigns:delete", id),
    getTable: (campaignId: string) =>
      ipcRenderer.invoke("campaigns:table", campaignId),
    listAll: () => ipcRenderer.invoke("campaigns:listAll"),
  },
  ads: {
    forCampaign: (campaignId: string) =>
      ipcRenderer.invoke("ads:forCampaign", campaignId),
  },
  meta: {
    listCampaigns: () => ipcRenderer.invoke("meta:campaigns"),
  },
  analytics: {
    levelFunnel: (input: LevelFunnelInput) =>
      ipcRenderer.invoke("analytics:levelFunnel", input),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (input: UpdateSettingsInput) =>
      ipcRenderer.invoke("settings:update", input),
  },
  targets: {
    get: () => ipcRenderer.invoke("targets:get"),
    set: (platform: PlatformKind, bands: TargetBands) =>
      ipcRenderer.invoke("targets:set", platform, bands),
  },
};

contextBridge.exposeInMainWorld("api", api);
