import { createSignal, onMount, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { getPlans, createCheckout } from '../../../services/ai-api.js';
import { subscription, refreshUserData } from '../../stores/aiStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function AIPlanDialog(props) {
  const { t } = useTranslation('ribbon');
  const [plans, setPlans] = createSignal([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');

  onMount(async () => {
    const p = await getPlans();
    setPlans(p);
  });

  async function handleSubscribe(planName) {
    setLoading(true);
    setError('');
    try {
      const { checkout_url } = await createCheckout(planName);
      window.open(checkout_url, '_blank');
      closeDialog('ai-plan');
      setTimeout(() => refreshUserData(), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function formatPrice(cents) {
    if (cents === 0) return t('ai.free');
    return '\u20AC' + (cents / 100).toFixed(2) + '/mo';
  }

  return (
    <Dialog
      title={t('ai.choosePlan')}
      dialogClass="ai-plan-dialog"
      onClose={() => closeDialog('ai-plan')}
      footer={null}
    >
      {error() && <div class="ai-login-error">{error()}</div>}
      <div class="ai-plans-grid">
        <For each={plans()}>
          {(plan) => {
            const isActive = () => subscription()?.plan_name === plan.name;
            return (
              <div class={'ai-plan-card' + (isActive() ? ' active' : '')}>
                <div class="ai-plan-name">{plan.name.charAt(0).toUpperCase() + plan.name.slice(1)}</div>
                <div class="ai-plan-price">{formatPrice(plan.price_cents)}</div>
                <div class="ai-plan-limits">
                  <div>{plan.monthly_credits.toLocaleString()} credits/mo</div>
                </div>
                <Show when={plan.features}>
                  <div class="ai-plan-features">
                    <For each={plan.features.split(',')}>
                      {(f) => <span class="ai-plan-feature-tag">{f.trim()}</span>}
                    </For>
                  </div>
                </Show>
                <Show when={isActive()}>
                  <button class="ai-plan-btn current" disabled>{t('ai.currentPlan')}</button>
                </Show>
                <Show when={!isActive() && plan.price_cents > 0}>
                  <button class="ai-plan-btn" onClick={() => handleSubscribe(plan.name)} disabled={loading()}>
                    {loading() ? '...' : t('ai.subscribe')}
                  </button>
                </Show>
                <Show when={!isActive() && plan.price_cents === 0}>
                  <button class="ai-plan-btn current" disabled>{t('ai.free')}</button>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </Dialog>
  );
}
