import '../styles/index.css';
import { startApp } from './app';
import type { DepthChartApi } from '../shared/depth-chart';
import type { PromoApi, TeamNeedsApi } from '../shared/types';

const bridge = window as unknown as { promoAPI: PromoApi; teamNeedsAPI: TeamNeedsApi; depthChartAPI: DepthChartApi };
const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing app root.');
startApp(root, bridge.promoAPI, bridge.teamNeedsAPI, bridge.depthChartAPI);
