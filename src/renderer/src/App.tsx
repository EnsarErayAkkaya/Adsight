import { useState } from "react";
import GamesView from "./views/GamesView";
import GameView from "./views/GameView";
import CampaignView from "./views/CampaignView";
import CompareView from "./views/CompareView";
import SettingsView from "./views/SettingsView";
import LevelFunnelView from "./views/LevelFunnelView";

export type Route =
  | { view: "games" }
  | { view: "game"; gameId: string }
  | { view: "campaign"; campaignId: string; gameId: string }
  | { view: "funnel"; gameId: string; campaignId?: string }
  | { view: "compare" }
  | { view: "settings" };

export default function App() {
  const [route, setRoute] = useState<Route>({ view: "games" });

  switch (route.view) {
    case "games":
      return <GamesView navigate={setRoute} />;
    case "game":
      return <GameView gameId={route.gameId} navigate={setRoute} />;
    case "campaign":
      return (
        <CampaignView
          campaignId={route.campaignId}
          gameId={route.gameId}
          navigate={setRoute}
        />
      );
    case "funnel":
      return (
        <LevelFunnelView
          gameId={route.gameId}
          campaignId={route.campaignId}
          navigate={setRoute}
        />
      );
    case "compare":
      return <CompareView navigate={setRoute} />;
    case "settings":
      return <SettingsView navigate={setRoute} />;
  }
}
