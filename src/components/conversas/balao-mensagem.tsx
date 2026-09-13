'use client'

import { memo } from 'react'
import type { Mensagem } from './api'
import { horaMinuto } from './formatadores'
import { ConteudoMensagem } from './conteudo-mensagem'
import { IconeCheck, IconeCheckDuplo, IconeRelogio } from './icones'

type BalaoProps = {
  mensagem: Mensagem
  termo: string
  destacada: boolean
  podeTentarDeNovo: boolean
  aoTentarDeNovo: (id: string) => void
  aoAbrirImagem: (url: string, legenda: string | null) => void
}

const ROTULO_STATUS: Record<Mensagem['status'], string> = {
  ENVIANDO: 'Enviando',
  ENVIADA: 'Enviada',
  ENTREGUE: 'Entregue',
  LIDA: 'Lida',
  ERRO: 'Não enviada',
}

function IconeStatus({ status }: { status: Mensagem['status'] }) {
  const props = { width: 16, height: 16, role: 'img', 'aria-hidden': false, 'aria-label': ROTULO_STATUS[status] }
  switch (status) {
    case 'ENVIANDO':
      return <IconeRelogio {...props} className="text-texto-secundario" />
    case 'ENVIADA':
      return <IconeCheck {...props} className="text-texto-secundario" />
    case 'ENTREGUE':
      return <IconeCheckDuplo {...props} className="text-texto-secundario" />
    case 'LIDA':
      // sky-600 e não o azul claro do WhatsApp: sobre o fundo `brand-bg` o
      // azul claro some, e é justamente a diferença entre ✓✓ cinza e azul que
      // o atendente precisa enxergar.
      return <IconeCheckDuplo {...props} className="text-sky-600" />
    case 'ERRO':
      return (
        <span role="img" aria-label={ROTULO_STATUS.ERRO} className="font-bold text-erro">
          !
        </span>
      )
  }
}

/**
 * Um balão da conversa. Cliente à esquerda; loja (atendente ou robô) à
 * direita — o lado diz de quem é sem precisar ler nada.
 *
 * `memo` porque a consulta periódica recria a lista a cada 5 s e uma conversa
 * longa tem centenas de balões; só o que mudou de verdade re-renderiza.
 */
export const BalaoMensagem = memo(function BalaoMensagem({
  mensagem,
  termo,
  destacada,
  podeTentarDeNovo,
  aoTentarDeNovo,
  aoAbrirImagem,
}: BalaoProps) {
  const doCliente = mensagem.autor === 'CLIENTE'
  const semFundo = mensagem.tipo === 'FIGURINHA' && mensagem.midia

  return (
    <div
      data-mensagem-id={mensagem.id}
      className={`flex w-full ${doCliente ? 'justify-start' : 'justify-end'}`}
    >
      <div
        className={`flex max-w-[85%] flex-col gap-1 rounded-cartao px-3 py-2 shadow-elevado sm:max-w-[70%] ${
          semFundo ? 'bg-transparent shadow-none' : doCliente ? 'bg-superficie-card' : 'bg-brand-bg'
        } ${destacada ? 'outline outline-2 outline-alerta' : ''}`}
      >
        {mensagem.autor === 'ROBO' ? (
          <span className="text-rotulo font-bold uppercase text-brand-texto">Robô</span>
        ) : null}

        <ConteudoMensagem mensagem={mensagem} termo={termo} aoAbrirImagem={aoAbrirImagem} />

        <span className="flex items-center justify-end gap-1 self-end text-rotulo text-texto-secundario">
          <time dateTime={mensagem.ocorridoEm}>{horaMinuto(mensagem.ocorridoEm)}</time>
          {doCliente ? null : <IconeStatus status={mensagem.status} />}
        </span>

        {mensagem.status === 'ERRO' ? (
          <span className="flex flex-wrap items-center gap-2 text-rotulo text-erro">
            <span>{mensagem.erro ?? 'Não foi possível enviar.'}</span>
            {podeTentarDeNovo ? (
              <button
                type="button"
                onClick={() => aoTentarDeNovo(mensagem.id)}
                className="font-bold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                Tentar de novo
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  )
})
