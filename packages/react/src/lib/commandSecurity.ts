/**
 * Worker が payload 内に自己申告した対象を、Host が把握している送信元へ束縛する。
 * Worker は改変可能なので payload.entityId だけを認可判断に使ってはいけない。
 */
export function isOwnComponentCommand(
    senderComponentInstanceId: string | undefined,
    payloadComponentInstanceId: string,
    mountedComponentInstanceId: string,
): boolean {
    return (
        senderComponentInstanceId === mountedComponentInstanceId &&
        payloadComponentInstanceId === mountedComponentInstanceId
    );
}
