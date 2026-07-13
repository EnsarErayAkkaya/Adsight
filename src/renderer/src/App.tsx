import { useState } from "react";
import GamesView from "./views/GamesView";
import GameView from "./views/GameView";
import CampaignView from "./views/CampaignView";

export type Route =
  | { view: "games" }
  | { view: "game"; gameId: string }
  | { view: "campaign"; campaignId: string; gameId: string };

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
  }
}
