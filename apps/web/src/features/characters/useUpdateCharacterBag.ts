import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { addBagItem, removeBagItem, setBagItemQuantity } from './api';
import { bagKey } from './useCharacterBag';
import type { CharacterBag } from './types';

export interface AddBagItemInput {
  category: string;
  name: string;
  itemId?: string | number | null;
  quantity: number;
}

/**
 * Add / adjust-quantity / remove items in a character's loot bag. Quantity and
 * remove are optimistic (they target an existing row by id); add refetches once
 * the server assigns the new row id. Each op targets a single `bag_items` row,
 * so there's no whole-blob clobber risk — concurrent bot edits to other rows
 * are unaffected, and this character's bag stays in sync via Realtime.
 */
export function useUpdateCharacterBag(charKey: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = bagKey(user?.id, charKey);

  const patchItems = (fn: (items: CharacterBag['items']) => CharacterBag['items']) => {
    const prev = qc.getQueryData<CharacterBag>(key);
    if (prev) qc.setQueryData<CharacterBag>(key, { ...prev, items: fn(prev.items) });
    return prev;
  };

  const add = useMutation<void, Error, AddBagItemInput>({
    scope: { id: `char-bag:${key.join(':')}` },
    mutationFn: async (input) => {
      if (!user) throw new Error('You need to be signed in.');
      await addBagItem({ userId: user.id, charKey, ...input });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const setQty = useMutation<void, Error, { rowId: string | number; quantity: number }, { prev?: CharacterBag }>({
    scope: { id: `char-bag:${key.join(':')}` },
    mutationFn: ({ rowId, quantity }) => setBagItemQuantity({ rowId, quantity }),
    onMutate: async ({ rowId, quantity }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = patchItems((items) =>
        quantity <= 0
          ? items.filter((i) => i.id !== rowId)
          : items.map((i) => (i.id === rowId ? { ...i, quantity } : i)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const remove = useMutation<void, Error, { rowId: string | number }, { prev?: CharacterBag }>({
    scope: { id: `char-bag:${key.join(':')}` },
    mutationFn: ({ rowId }) => removeBagItem({ rowId }),
    onMutate: async ({ rowId }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = patchItems((items) => items.filter((i) => i.id !== rowId));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  return {
    addItem: (input: AddBagItemInput) => add.mutate(input),
    setQuantity: (rowId: string | number, quantity: number) => setQty.mutate({ rowId, quantity }),
    removeItem: (rowId: string | number) => remove.mutate({ rowId }),
    isAdding: add.isPending,
    isError: add.isError || setQty.isError || remove.isError,
    error: add.error ?? setQty.error ?? remove.error,
  };
}
