import '../styles/index.css';
import { startApp } from './app';
import type { PromoApi, TeamNeedsApi } from '../shared/types';

const bridge = window as unknown as { promoAPI: PromoApi; teamNeedsAPI: TeamNeedsApi };
const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing app root.');
startApp(root, bridge.promoAPI, bridge.teamNeedsAPI);
