import { Show, For } from 'solid-js';
import { createSignal } from 'solid-js';
import { annotProps, sectionVis, addReply, deleteReply } from '../../stores/propertiesStore.js';
import { formatDate } from '../../../utils/helpers.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function RepliesSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const [replyText, setReplyText] = createSignal('');

  const handleAddReply = () => {
    if (!replyText().trim()) return;
    addReply(replyText());
    setReplyText('');
  };

  return (
    <Show when={sectionVis.replies}>
      <CollapsibleSection title={t('replies.title')} name="replies" id="prop-replies-section">
        <div class="prop-replies-list">
          <Show when={!annotProps.replies || annotProps.replies.length === 0}>
            <div style="font-size: 11px; color: var(--theme-text-secondary); font-style: italic; padding: 4px 0;">
              {t('replies.noReplies')}
            </div>
          </Show>
          <For each={annotProps.replies}>
            {(reply, index) => (
              <div style="padding: 4px 0; border-bottom: 1px solid var(--theme-border); font-size: 11px;">
                <div style="display: flex; justify-content: space-between; color: var(--theme-text-secondary);">
                  <strong>{reply.author || t('replies.user')}</strong>
                  <span>{formatDate(reply.createdAt)}</span>
                </div>
                <div style="color: var(--theme-text); margin-top: 2px;">{reply.text}</div>
                <button
                  style="border: none; background: none; color: #ef4444; cursor: pointer; font-size: 10px; padding: 2px 0;"
                  onClick={() => deleteReply(index())}>
                  {tCommon('delete')}
                </button>
              </div>
            )}
          </For>
        </div>
        <div class="prop-reply-row">
          <input type="text" class="prop-reply-input" placeholder={t('replies.addReply')}
            value={replyText()}
            onInput={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddReply(); }} />
          <button class="prop-reply-add-btn" onClick={handleAddReply}>{t('replies.addButton')}</button>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
