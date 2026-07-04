import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { updateCharacterNotes, type CharacterNoteBook } from './api';
import { notesKey } from './useCharacterNotes';
import type { CharacterNoteEntry } from './types';

/**
 * Add / edit / delete entries in a character's `character_notes` book, with
 * optimistic updates and the overlay's anti-clobber discipline (the server
 * write is a compare-and-swap read-modify-write, so a concurrent bot note is
 * never lost). Notes authored on the web match the bot's entry shape
 * (`{ id, category, text, pinned, author*, createdAt }`) so they render and
 * sync identically on both sides.
 */
export function useUpdateCharacterNotes(charKey: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = notesKey(user?.id, charKey);

  const mutation = useMutation<void, Error, (book: CharacterNoteBook) => CharacterNoteBook, { prev?: CharacterNoteEntry[] }>({
    // Serialize note writes to one character so rapid edits compose in order.
    scope: { id: `char-notes:${key.join(':')}` },
    mutationFn: async (mutate) => {
      if (!user) throw new Error('You need to be signed in.');
      await updateCharacterNotes({ userId: user.id, charKey, mutate });
    },
    onMutate: async (mutate) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<CharacterNoteEntry[]>(key);
      const notes = prev ?? [];
      // The notes query caches only the list, not the id counter — reconstruct a
      // plausible nextId for the optimistic view; the server assigns the real one.
      const nextId = notes.reduce((m, n) => Math.max(m, Number(n.id) || 0), 0) + 1;
      const book = mutate({ nextId, notes });
      qc.setQueryData<CharacterNoteEntry[]>(key, book.notes);
      return { prev };
    },
    onError: (_err, _mutate, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
    },
  });

  const addNote = (text: string) =>
    mutation.mutate((book) => ({
      nextId: book.nextId + 1,
      notes: [
        ...book.notes,
        {
          id: book.nextId,
          category: 'general',
          text: text.trim(),
          pinned: false,
          authorId: user?.id ?? null,
          authorName: 'Web',
          createdAt: new Date().toISOString(),
        },
      ],
    }));

  const editNote = (id: number, text: string) =>
    mutation.mutate((book) => ({
      ...book,
      notes: book.notes.map((n) => (Number(n.id) === id ? { ...n, text: text.trim() } : n)),
    }));

  const deleteNote = (id: number) =>
    mutation.mutate((book) => ({
      ...book,
      notes: book.notes.filter((n) => Number(n.id) !== id),
    }));

  return {
    addNote,
    editNote,
    deleteNote,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}
