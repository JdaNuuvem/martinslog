'use client'

import { useEffect, useId, useRef, useState } from 'react'

const CHAVE_DISPENSA = 'fluxo-personalizado-dispensado'

/**
 * Convite para ligar o percurso personalizado que a conta montou mas deixou
 * desligado.
 *
 * Um fluxo salvo e inativo não faz nada: as etiquetas continuam saindo com o
 * roteiro automático, e quem desenhou o percurso não tem como saber disso
 * olhando a tela do construtor. O aviso aparece na home enquanto essa
 * situação durar.
 *
 * "Agora não" vale pela sessão do navegador (`sessionStorage`), não para
 * sempre: a decisão de deixar o fluxo desligado é reversível, e quem
 * dispensou por pressa merece a lembrança na próxima visita — mas não a cada
 * navegação entre páginas.
 */
export function ModalAtivarFluxo() {
  const idBase = useId()
  const dialogo = useRef<HTMLDialogElement>(null)

  const [visivel, setVisivel] = useState(false)
  const [ativando, setAtivando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<number | null>(null)

  useEffect(() => {
    let cancelado = false

    void (async () => {
      try {
        if (sessionStorage.getItem(CHAVE_DISPENSA) === '1') return
      } catch {
        // Navegador sem storage acessível: mostrar o aviso é melhor que
        // esconder um fluxo que a conta desenhou e não está valendo.
      }

      try {
        const resposta = await fetch('/api/rastreio-template')
        if (!resposta.ok || cancelado) return
        const { template } = (await resposta.json()) as {
          template: { ativo: boolean } | null
        }
        if (!cancelado && template && !template.ativo) {
          setVisivel(true)
        }
      } catch {
        // Sem rede, sem aviso. Nada aqui é urgente o bastante para insistir.
      }
    })()

    return () => {
      cancelado = true
    }
  }, [])

  useEffect(() => {
    if (visivel) dialogo.current?.showModal()
  }, [visivel])

  function dispensar() {
    try {
      sessionStorage.setItem(CHAVE_DISPENSA, '1')
    } catch {
      // Sem storage, o aviso volta na próxima navegação. Aceitável.
    }
    dialogo.current?.close()
  }

  async function ativar() {
    setErro(null)
    setAtivando(true)
    try {
      const resposta = await fetch('/api/rastreio-template/ativar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ativo: true, reaplicarNosEnvios: true }),
      })
      const corpo: unknown = await resposta.json()

      if (!resposta.ok) {
        const falha = corpo as { mensagem?: string }
        setErro(falha.mensagem ?? 'Não foi possível ativar o percurso agora.')
        return
      }

      const { enviosAtualizados } = corpo as { enviosAtualizados: number }
      setResultado(enviosAtualizados)
    } catch {
      setErro('Não foi possível conectar ao servidor.')
    } finally {
      setAtivando(false)
    }
  }

  if (!visivel) return null

  return (
    <dialog
      ref={dialogo}
      data-testid="modal-ativar-fluxo"
      aria-labelledby={`${idBase}-titulo`}
      onClose={() => setVisivel(false)}
      className="w-full max-w-md rounded-painel bg-superficie-card p-0 text-texto-principal shadow-flutuante backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-2">
          <h2 id={`${idBase}-titulo`} className="text-subtitulo font-semibold text-texto-principal">
            {resultado === null ? 'Ativar seu percurso personalizado?' : 'Percurso ativado'}
          </h2>

          {resultado === null ? (
            <>
              <p className="text-dado text-texto-secundario">
                Você montou um percurso próprio em <strong>Fluxo do rastreio</strong>, mas ele está
                desligado: as etiquetas continuam saindo com o percurso automático.
              </p>
              <p className="text-dado text-texto-secundario">
                Ao ativar, ele passa a valer para as próximas etiquetas <strong>e</strong> reescreve
                a linha do tempo dos envios que você já emitiu. Rastreios que seus clientes já
                consultaram podem mostrar outras etapas depois disso. Envios cancelados não mudam.
              </p>
            </>
          ) : (
            <p className="text-dado text-texto-secundario">
              O percurso está valendo para as próximas etiquetas.{' '}
              {resultado === 0
                ? 'Nenhum envio anterior precisou ser reescrito.'
                : `${resultado} envio${resultado > 1 ? 's já emitidos foram reescritos' : ' já emitido foi reescrito'} com ele.`}
            </p>
          )}
        </div>

        {erro && (
          <p role="alert" className="rounded-campo bg-erro-fundo p-3 text-dado text-erro">
            {erro}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          {resultado === null ? (
            <>
              <button
                type="button"
                onClick={dispensar}
                className="rounded-campo border border-borda-campo px-4 py-2 text-dado font-medium text-texto-principal focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                Agora não
              </button>
              <button
                type="button"
                onClick={ativar}
                disabled={ativando}
                className="rounded-campo bg-brand px-4 py-2.5 text-dado font-medium text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                {ativando ? 'Ativando…' : 'Ativar para todos'}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => dialogo.current?.close()}
              className="rounded-campo bg-brand px-4 py-2.5 text-dado font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Fechar
            </button>
          )}
        </div>
      </div>
    </dialog>
  )
}
