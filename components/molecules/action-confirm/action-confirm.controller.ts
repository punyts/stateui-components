import type { ControllerContext } from '@punyts/stateui';

/**
 * Approve sets `status` to `approved` and raises `approve`; reject sets `rejected` and raises `reject`. Once
 * decided the buttons give way to the outcome, so one proposal is answered once; logic that sends the decision to the
 * agent listens for the events, and a proposal shown again with `status` back at `pending` asks again
 */
export default function controller({ element, store, basePath }: ControllerContext) {
    const statusPath = `${basePath}.status`;
    const decide = (status: 'approved' | 'rejected', event: 'approve' | 'reject'): void => {
        if (store.get<unknown>(statusPath) !== 'pending' || store.get<unknown>(`${basePath}.disabled`) === true) return;
        store.set(statusPath, status);
        element.dispatchEvent(new CustomEvent(event, { bubbles: true, composed: true }));
    };
    return {
        onApprove: () => decide('approved', 'approve'),
        onReject: () => decide('rejected', 'reject')
    };
}
