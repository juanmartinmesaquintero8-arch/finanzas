// Helpers puros
export * from './lib/types';
export * from './lib/format';
export * from './lib/validation';
export * from './lib/domain-helpers';
export * from './lib/cards';
export type { ActionResult } from './lib/action-result';

// Estilos compartidos
export { ui } from './styles';

// Componentes presentacionales
export { AccountCards } from './components/AccountCards';
export { AccountFilterChips } from './components/AccountFilterChips';
export { AddTransactionForm } from './components/AddTransactionForm';
export { AvailableBalanceCard } from './components/AvailableBalanceCard';
export { BottomNav, DEFAULT_TABS, NAV_ICONS, type NavTab } from './components/BottomNav';
export { ChipGroup, type ChipOption } from './components/ChipGroup';
export { ErrorCard } from './components/ErrorCard';
export { PageContainer } from './components/PageContainer';
export { HistoryList } from './components/HistoryList';
export { HistoryView } from './components/HistoryView';
export { NewAccountForm } from './components/NewAccountForm';
export { ScheduledForm } from './components/ScheduledForm';
export { ScheduledList } from './components/ScheduledList';
export { ScheduledScreen } from './components/ScheduledScreen';
export { TransactionTypeChips, TRANSACTION_TYPE_OPTIONS } from './components/TransactionTypeChips';
export { UpcomingCommitments } from './components/UpcomingCommitments';
export { SpendingBreakdown } from './components/SpendingBreakdown';
export { SpendingHomeCard } from './components/SpendingHomeCard';
export { HistoryViewSwitch } from './components/HistoryViewSwitch';
export { ActiveFilters, type ActiveFilter } from './components/ActiveFilters';
export { ScheduledKindSwitch } from './components/ScheduledKindSwitch';
export { CardsScreen } from './components/CardsScreen';
export { CardDebtStat } from './components/CardDebtStat';
export { ExpectedIncomeNote } from './components/ExpectedIncomeNote';
export { SCHEDULED_COPY, type ScheduledKind, type ScheduledCopy } from './lib/scheduled-copy';
