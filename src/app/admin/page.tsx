"use client";

import { useEffect, useState } from "react";

type User = {
  id: string;
  email: string;
  name?: string | null;
  createdAt: string;
};

type AdminData = {
  count: number;
  users: User[];
};

export default function AdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAdmin() {
      setError(null);
      setLoading(true);

      const res = await fetch("/api/admin");
      setLoading(false);

      if (res.ok) {
        const json: AdminData = await res.json();
        setData(json);
      } else {
        setError("Unauthorized");
      }
    }

    void loadAdmin();
  }, []);

  if (loading) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <h1 className="text-xl font-bold mb-4">Admin Panel</h1>
        <p>Loading...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <h1 className="text-xl font-bold mb-4">Admin Panel</h1>
        {error && <p className="text-red-500 mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Admin Panel</h1>

      {error && <p className="text-red-500 mb-2">{error}</p>}

      <p className="mb-4 font-medium">Total users: {data.count}</p>

      <div className="overflow-x-auto">
        <table className="border w-full">
          <thead>
            <tr className="bg-gray-100">
              <th className="p-2 border text-left">Email</th>
              <th className="p-2 border text-left">Name</th>
              <th className="p-2 border text-left">Created At</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id}>
                <td className="p-2 border">{u.email}</td>
                <td className="p-2 border">{u.name || "-"}</td>
                <td className="p-2 border">
                  {new Date(u.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
            {data.users.length === 0 && (
              <tr>
                <td colSpan={3} className="p-3 text-center text-gray-500">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
