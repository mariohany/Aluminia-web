import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as filesApi from '@/lib/files-api'

/** A stored file as an object URL for `<img src>`, or null while loading
 * / when there is none. Cached by id (a file never changes: a new upload
 * gets a new id); the URL is revoked when the id changes or on unmount. */
export function useFileObjectUrl(id: string | null | undefined): string | null {
  const { data } = useQuery({
    queryKey: ['files', id],
    queryFn: () => filesApi.getFileBlob(id!),
    enabled: !!id,
    staleTime: Infinity,
  })
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!data || !id) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(data)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [data, id])

  return url
}
