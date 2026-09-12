'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Recarrega os dados da página sozinho, de tempos em tempos.
 *
 * As telas de administração são componentes de servidor: o que elas mostram é
 * o retrato do instante em que foram abertas. Para quem acompanha pedido
 * chegando, isso é informação velha em minutos — e ninguém fica apertando F5.
 *
 * `router.refresh()` refaz só a árvore do servidor e recolhe o resultado sobre
 * a página atual: a rolagem fica onde está, o que o usuário digitou no filtro
 * não some, e a tela não pisca. É a diferença entre atualizar e recarregar.
 *
 * Duas contenções deliberadas:
 *
 *  - **Aba escondida não atualiza.** Uma aba esquecida aberta a noite toda
 *    faria centenas de consultas ao banco sem ninguém olhando. Ao voltar para
 *    a aba, atualiza na hora — que é justamente quando alguém quer ver.
 *  - **Dá para desligar.** Quem está lendo uma linha específica não quer a
 *    lista se reordenando embaixo do cursor.
 */
export function AtualizaSozinho({ segundos = 30 }: { segundos?: number }) {
  const router = useRouter()
  const [ligado, setLigado] = useState(true)
  const [ultima, setUltima] = useState<Date | null>(null)
  /*
    O horário só nasce depois de montar. Se o servidor renderizasse um relógio,
    ele já viria diferente do primeiro instante do cliente e o React reclamaria
    de hidratação — o texto começa vazio de propósito.
  */
  const ligadoRef = useRef(ligado)
  ligadoRef.current = ligado

  useEffect(() => {
    if (!ligado) return

    function atualizar() {
      if (document.visibilityState !== 'visible') return
      router.refresh()
      setUltima(new Date())
    }

    const relogio = setInterval(atualizar, segundos * 1000)

    function aoVoltar() {
      if (document.visibilityState === 'visible' && ligadoRef.current) atualizar()
    }
    document.addEventListener('visibilitychange', aoVoltar)

    return () => {
      clearInterval(relogio)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [ligado, segundos, router])

  return (
    <div className="flex flex-wrap items-center gap-3 text-dado text-texto-secundario">
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${ligado ? 'animate-pulse bg-sucesso' : 'bg-texto-secundario'}`}
        />
        {ligado ? `Atualizando a cada ${segundos}s` : 'Atualização automática desligada'}
      </span>

      {ultima ? (
        <span>
          última às{' '}
          <time dateTime={ultima.toISOString()}>
            {ultima.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </time>
        </span>
      ) : null}

      <button
        type="button"
        onClick={() => setLigado((v) => !v)}
        aria-pressed={ligado}
        className="rounded-pilula border border-borda-campo px-3 py-1 text-sm text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        {ligado ? 'Pausar' : 'Retomar'}
      </button>

      <button
        type="button"
        onClick={() => {
          router.refresh()
          setUltima(new Date())
        }}
        className="rounded-pilula border border-borda-campo px-3 py-1 text-sm text-texto-principal focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      >
        Atualizar agora
      </button>
    </div>
  )
}
