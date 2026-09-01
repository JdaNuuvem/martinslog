import { ListaEtiquetas } from '@/components/lista-etiquetas'

/**
 * Gestão das etiquetas do cliente: o que ele contratou e o que pode fazer
 * com cada envio.
 *
 * Não há impressão de etiqueta aqui — por decisão do produto, a geração de
 * PDF não faz parte desta tela. As ações são ver detalhes, rastrear e
 * cancelar enquanto o envio não saiu para entrega.
 */
export default function PaginaEtiquetas() {
  return (
    <div className="flex flex-col gap-secao">
      <div className="flex flex-col gap-1">
        <h1 className="text-titulo font-bold text-texto-principal">Etiquetas</h1>
        <p className="max-w-leitura text-corpo text-texto-secundario">
          Seus envios, por situação. O cancelamento é possível até a postagem e não devolve o
          valor pago.
        </p>
      </div>

      <ListaEtiquetas />
    </div>
  )
}
