import { contextBridge, ipcRenderer } from "electron";
import type {
  Api,
  CreateCampaignInput,
  CreateGameInput,
  CreatePlatformInput,
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
    delete: (id: string) => ipcRenderer.invoke("campaigns:delete", id),
    getTable: (campaignId: string) =>
      ipcRenderer.invoke("campaigns:table", campaignId),
  },
};

contextBridge.exposeInMainWorld("api", api);
