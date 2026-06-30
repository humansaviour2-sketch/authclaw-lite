import { backendFetch, handleApiError } from "@/lib/api-client";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await backendFetch(`/v1/users/${id}`, {
      method: "DELETE",
    });
    return new Response(null, { status: 204 });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
