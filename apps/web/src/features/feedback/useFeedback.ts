import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import {
  fetchFeedback,
  submitFeedback,
  updateFeedbackStatus,
  type FeedbackInput,
  type FeedbackStatus,
} from './api';

/** Submit a contact / feedback message. Stamps the signed-in user id when present. */
export function useSubmitFeedback() {
  const { user } = useAuth();
  return useMutation({
    mutationFn: (input: Omit<FeedbackInput, 'userId'>) =>
      submitFeedback({ ...input, userId: user?.id ?? null }),
  });
}

/** Admin: the feedback inbox. */
export function useFeedbackInbox(enabled: boolean) {
  return useQuery({ queryKey: ['feedback-inbox'], queryFn: fetchFeedback, enabled });
}

/** Admin: mutate a submission's triage status, refreshing the inbox. */
export function useUpdateFeedbackStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: FeedbackStatus }) =>
      updateFeedbackStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback-inbox'] }),
  });
}
